"""
KinoPlex Web Application
A next-generation phosphorylation prediction and visualization platform

This Flask application provides an elegant interface for exploring
phosphorylation site predictions and kinase specificity across proteins.
"""

from flask import Flask, render_template, jsonify, request
from kinoplex_query import KinoPlexQuery
from uniprot_integration import get_protein_data, get_sequence_motif
import logging
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'  # Change in production

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Initialize the database query interface
# This connection is reused across requests for efficiency
db = KinoPlexQuery('kinoplex.db')


@app.route('/')
def index():
    """
    Landing page - the user's first impression of KinoPlex.

    This page serves as both branding and gateway. It introduces the tool
    while immediately presenting the primary action: protein search.
    """
    return render_template('index.html')


@app.route('/protein/<identifier>')
def protein_page(identifier):
    protein_info = db.get_protein_info(identifier)

    if not protein_info:
        return render_template('error.html',
                               message=f"Protein '{identifier}' not found in database",
                               search_again=True), 404

    data = db.get_complete_protein_data(identifier)

    # Fetch UniProt data
    uniprot_data = get_protein_data(protein_info['uniprot'])

    # DEBUG: Print what we got
    print(f"DEBUG: UniProt ID: {protein_info['uniprot']}")
    print(f"DEBUG: uniprot_data is None: {uniprot_data is None}")
    if uniprot_data:
        print(f"DEBUG: Sequence length: {len(uniprot_data.get('sequence', ''))}")
        print(f"DEBUG: Protein name: {uniprot_data.get('protein_name', 'N/A')}")
    else:
        print("DEBUG: uniprot_data is None or empty!")

    if not uniprot_data:
        uniprot_data = {
            'accession': protein_info['uniprot'],
            'gene_name': protein_info.get('gene_symbol', 'N/A'),
            'protein_name': 'Information unavailable',
            'organism': 'Unknown',
            'function': 'UniProt data could not be retrieved.',
            'sequence': '',
            'length': 0
        }

    return render_template('protein.html',
                           protein=data['protein'],
                           stats=data['statistics'],
                           uniprot=uniprot_data)


@app.route('/api/search')
def search_proteins():
    """
    Autocomplete API endpoint for protein search.

    This powers the search box suggestions as users type. The key here
    is speed - we want suggestions to appear within ~100ms of each keystroke
    so the experience feels instantaneous.

    Query parameters:
        q: Search query string (minimum 2 characters recommended)

    Returns:
        JSON array of matching proteins with their identifiers
    """
    query = request.args.get('q', '').strip()

    # Require at least 2 characters to prevent overwhelming results
    # and reduce unnecessary database queries
    if len(query) < 2:
        return jsonify([])

    # The database query uses indexed LIKE operations for fast matching
    results = db.search_proteins(query)

    return jsonify(results)


@app.route('/api/protein/<identifier>')
def api_get_protein_data(identifier):
    """
    Primary data API - returns complete phosphorylation data for visualization.

    This is the workhorse endpoint that powers the lollipop plot and all
    interactive features. It returns everything needed to render the full
    visualization without requiring additional queries.

    The response is structured to match exactly what the D3.js visualization
    expects, minimizing client-side data transformation.

    Args:
        identifier: UniProt ID or gene symbol

    Returns:
        JSON object with protein info, sites, and statistics
    """
    try:
        app.logger.info(f'API request for protein: {identifier}')

        data = db.get_complete_protein_data(identifier)

        if not data:
            app.logger.warning(f'Protein not found: {identifier}')
            return jsonify({'error': 'Protein not found'}), 404

        # Get the protein sequence to determine actual S/T/Y residues
        protein_info = db.get_protein_info(identifier)
        uniprot_data = get_protein_data(protein_info['uniprot'])

        sequence = None
        if uniprot_data and 'sequence' in uniprot_data:
            sequence = uniprot_data['sequence']
            app.logger.info(f'Retrieved sequence of length {len(sequence)} for residue mapping')

        app.logger.info(f'Successfully loaded {len(data["sites"])} sites for {identifier}')

        sites_data = []
        for site in data['sites']:
            # Determine the actual residue from the sequence
            residue = 'S'  # Default fallback

            if sequence and site.position <= len(sequence):
                # Get the actual amino acid at this position (1-indexed)
                actual_residue = sequence[site.position - 1]

                # Validate it's a phosphorylatable residue
                if actual_residue in ['S', 'T', 'Y']:
                    residue = actual_residue
                    app.logger.debug(f'Position {site.position}: {residue}')
                else:
                    app.logger.warning(f'Position {site.position} has non-phosphorylatable residue: {actual_residue}')
            else:
                # If no sequence available, try to infer from the site identifier
                # or from kinase preferences (Y kinases typically have Y in their name)
                if site.residue_type:
                    residue = site.residue_type
                else:
                    # Last resort: check if this is likely a tyrosine site
                    # based on kinase scores
                    if site.kinase_scores:
                        # If we have high scores for tyrosine kinases, it's likely Y
                        tyrosine_kinases = ['ABL', 'SRC', 'FYN', 'LCK', 'SYK', 'JAK', 'EGFR', 'PDGFR']
                        max_tk_score = max(
                            [site.kinase_scores.get(tk, 0) for tk in tyrosine_kinases if tk in site.kinase_scores],
                            default=0)
                        if max_tk_score > 50:  # If any tyrosine kinase has >50% score
                            residue = 'Y'

            site_dict = {
                'position': site.position,
                'residue': residue,  # Now this is the actual residue from sequence
                'site_id': site.site,
                'probability_raw': round(site.predicted_prob_raw, 4),
                'probability_calibrated': round(site.predicted_prob_calibrated, 4),
                'known_positive': site.known_positive,
                'fdr_05': site.fdr_05,
                'fdr_02': site.fdr_02,
                'fdr_01': site.fdr_01,
                'kinase_scores': site.kinase_scores
            }
            sites_data.append(site_dict)

        return jsonify({
            'protein': data['protein'],
            'sites': sites_data,
            'statistics': data['statistics']
        })

    except Exception as e:
        app.logger.error(f'Error loading protein {identifier}: {str(e)}', exc_info=True)
        return jsonify({
            'error': 'Failed to load protein data',
            'details': str(e)
        }), 500


@app.route('/api/protein/<identifier>/kinase/<kinase_name>')
def get_kinase_profile(identifier, kinase_name):
    """
    Focused API endpoint for kinase-specific analysis.

    Returns the activity profile of a single kinase across all sites
    in the protein. This enables detailed exploration of individual
    kinase-substrate relationships.

    Args:
        identifier: UniProt ID or gene symbol
        kinase_name: Name of the kinase to profile

    Returns:
        JSON array of sites with their scores for this kinase
    """
    profile = db.get_kinase_profile_across_protein(identifier, kinase_name)

    if not profile:
        return jsonify({'error': 'No data found'}), 404

    return jsonify(profile)


@app.route('/api/protein/<identifier>/sequence')
def get_protein_sequence(identifier):
    """
    API endpoint to retrieve the full protein sequence.

    This is used by the sequence viewer in the visualization to display
    the actual amino acid sequence with highlighted phosphorylation sites.

    Args:
        identifier: UniProt ID or gene symbol

    Returns:
        JSON with the protein sequence
    """
    try:
        # Get protein info to get the UniProt ID
        protein_info = db.get_protein_info(identifier)

        if not protein_info:
            return jsonify({'error': 'Protein not found'}), 404

        uniprot_id = protein_info['uniprot']

        # Fetch the protein data including sequence from UniProt
        uniprot_data = get_protein_data(uniprot_id)

        if not uniprot_data or 'sequence' not in uniprot_data:
            return jsonify({'error': 'Could not retrieve sequence'}), 404

        return jsonify({
            'sequence': uniprot_data['sequence'],
            'length': len(uniprot_data['sequence'])
        })

    except Exception as e:
        app.logger.error(f'Error retrieving sequence for {identifier}: {str(e)}', exc_info=True)
        return jsonify({
            'error': 'Failed to retrieve sequence',
            'details': str(e)
        }), 500


@app.route('/api/protein/<identifier>/site/<int:position>/motif')
def get_site_motif(identifier, position):
    """
    API endpoint to retrieve the sequence motif around a phosphorylation site.

    This is called when a user clicks on a site in the visualization. We return
    the amino acid sequence surrounding that site, which helps researchers understand
    the sequence context that determines kinase specificity. Kinase recognition motifs
    typically extend about 7 residues in each direction from the phosphorylation site.

    For example, if position 15 has a serine, we'll return something like:
    "PSVEPPLSQETFSGL" where the S at the center is the phosphorylation site.

    Args:
        identifier: UniProt ID or gene symbol
        position: Position of the site in the protein sequence (1-indexed)

    Returns:
        JSON with motif sequence and metadata
    """
    try:
        # Get protein info to ensure we have the correct UniProt ID
        protein_info = db.get_protein_info(identifier)

        if not protein_info:
            return jsonify({'error': 'Protein not found'}), 404

        uniprot_id = protein_info['uniprot']

        # Fetch the sequence motif from UniProt
        # Window of 7 means we get 7 residues on each side of the site
        motif = get_sequence_motif(uniprot_id, position, window=7)

        if not motif:
            return jsonify({'error': 'Could not retrieve sequence motif'}), 404

        # Also get the specific residue at this position for validation
        from uniprot_integration import uniprot_client
        residue = uniprot_client.get_residue_at_position(uniprot_id, position)

        # Calculate where in the motif the phosphorylation site is
        # This helps us highlight it in the display
        # If we got a full window (15 residues), the site should be at index 7
        # But if we're near the protein terminus, it might be offset
        motif_length = len(motif)
        center_index = min(7, position - 1)  # Account for N-terminus

        return jsonify({
            'motif': motif,
            'position': position,
            'residue': residue,
            'motif_length': motif_length,
            'center_index': center_index
        })

    except Exception as e:
        app.logger.error(f'Error retrieving motif for position {position}: {str(e)}', exc_info=True)
        return jsonify({
            'error': 'Failed to retrieve sequence motif',
            'details': str(e)
        }), 500


@app.route('/api/stats')
def database_statistics():
    """
    Database statistics endpoint.

    Returns overall database metrics useful for the about page
    or for displaying database coverage to users.
    """
    stats = db.get_database_statistics()
    return jsonify(stats)


@app.errorhandler(404)
def not_found(error):
    """Custom 404 page that maintains the site aesthetic"""
    return render_template('error.html',
                         message="Page not found",
                         search_again=True), 404


@app.errorhandler(500)
def internal_error(error):
    """Custom 500 page for graceful error handling"""
    return render_template('error.html',
                         message="An internal error occurred. Please try again later.",
                         search_again=False), 500

@app.route('/about')
def about():
    return render_template('about.html')


if __name__ == '__main__':
    # Development server configuration
    # In production, use gunicorn or another WSGI server
    app.run(debug=True, host='0.0.0.0', port=5000)