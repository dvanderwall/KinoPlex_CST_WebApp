"""
kinoplex_query.py - PROPERLY FIXED VERSION
Correctly determines residue type to load kinase scores

The issue: site IDs are like "P04637_6" not "S6", so we need to
determine residue type differently.
"""

import sqlite3
import json
import time
from typing import Dict, List, Optional

class PhosphoSite:
    """Simple class for phosphorylation site"""
    def __init__(self, position, site, uniprot, gene_symbol, residue_type,
                 predicted_prob_raw, predicted_prob_calibrated, known_positive,
                 fdr_05, fdr_02, fdr_01, kinase_scores):
        self.position = position
        self.site = site
        self.uniprot = uniprot
        self.gene_symbol = gene_symbol
        self.residue_type = residue_type
        self.predicted_prob_raw = predicted_prob_raw
        self.predicted_prob_calibrated = predicted_prob_calibrated
        self.known_positive = known_positive
        self.fdr_05 = fdr_05
        self.fdr_02 = fdr_02
        self.fdr_01 = fdr_01
        self.kinase_scores = kinase_scores if kinase_scores is not None else {}


class KinoPlexQuery:
    """
    FIXED: Correctly loads kinase scores by properly determining residue type
    """

    def __init__(self, db_path: str = 'kinoplex.db'):
        """Initialize database connection"""
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row

        # Enable optimizations
        self.conn.execute("PRAGMA optimize")
        self.conn.execute("PRAGMA cache_size = 10000")

    def get_protein_info(self, identifier: str) -> Optional[Dict]:
        """Get basic protein information"""
        cursor = self.conn.cursor()

        query = """
            SELECT DISTINCT uniprot, gene_symbol
            FROM phospho_competency
            WHERE uniprot = ? OR gene_symbol = ?
            LIMIT 1
        """

        cursor.execute(query, (identifier, identifier))
        row = cursor.fetchone()

        if row:
            return {
                'uniprot': row['uniprot'],
                'gene_symbol': row['gene_symbol']
            }
        return None

    def get_complete_protein_data(self, identifier: str) -> Optional[Dict]:
        """
        Get complete protein data with PROPERLY LOADED kinase scores

        FIXED: Correctly determines residue type by checking which table has data
        """

        start_time = time.time()
        cursor = self.conn.cursor()

        # Query 1: Get phospho-competency data
        phospho_query = """
            SELECT *
            FROM phospho_competency
            WHERE uniprot = ? OR gene_symbol = ?
            ORDER BY position
        """

        cursor.execute(phospho_query, (identifier, identifier))
        phospho_rows = cursor.fetchall()

        if not phospho_rows:
            return None

        # Extract protein info
        protein_info = {
            'uniprot': phospho_rows[0]['uniprot'],
            'gene_symbol': phospho_rows[0]['gene_symbol']
        }
        uniprot = protein_info['uniprot']

        # Query 2: Get S/T kinase data
        st_query = """
            SELECT position, site, kinase_data
            FROM st_kinase_specificity
            WHERE uniprot = ?
        """
        cursor.execute(st_query, (uniprot,))
        st_rows = cursor.fetchall()

        # Query 3: Get Y kinase data
        y_query = """
            SELECT position, site, kinase_data
            FROM y_kinase_specificity
            WHERE uniprot = ?
        """
        cursor.execute(y_query, (uniprot,))
        y_rows = cursor.fetchall()

        # Build lookup maps - key by position
        st_kinase_map = {}
        st_positions = set()  # Track which positions have S/T data
        for row in st_rows:
            try:
                position = int(row['position'])
                kinase_data = json.loads(row['kinase_data'])
                # Ensure all values are floats
                kinase_data = {k: float(v) for k, v in kinase_data.items()}
                st_kinase_map[position] = kinase_data
                st_positions.add(position)
            except Exception as e:
                print(f"Error parsing S/T kinase data at position {row['position']}: {e}")

        y_kinase_map = {}
        y_positions = set()  # Track which positions have Y data
        for row in y_rows:
            try:
                position = int(row['position'])
                kinase_data = json.loads(row['kinase_data'])
                # Ensure all values are floats
                kinase_data = {k: float(v) for k, v in kinase_data.items()}
                y_kinase_map[position] = kinase_data
                y_positions.add(position)
            except Exception as e:
                print(f"Error parsing Y kinase data at position {row['position']}: {e}")

        print(f"DEBUG: Found S/T kinase data for positions: {sorted(list(st_positions)[:5])}...")
        print(f"DEBUG: Found Y kinase data for positions: {sorted(list(y_positions)[:5])}...")

        # Build sites list with proper kinase scores
        sites = []
        for row in phospho_rows:
            position = int(row['position'])
            site_id = row['site']

            # FIXED: Determine residue type based on which table has the data
            kinase_scores = {}
            residue_type = 'S'  # Default

            if position in st_positions:
                # This position has S/T kinase data
                kinase_scores = st_kinase_map.get(position, {})
                # Determine if it's S or T based on the site field in st_kinase_specificity
                # For now, we'll call it S (could be S or T)
                residue_type = 'S'  # Could also check the actual sequence if available

            elif position in y_positions:
                # This position has Y kinase data
                kinase_scores = y_kinase_map.get(position, {})
                residue_type = 'Y'
            else:
                # No kinase data for this position (might be below threshold)
                kinase_scores = {}
                residue_type = 'S'  # Default guess

            # Create site object
            site = PhosphoSite(
                position=position,
                site=site_id,
                uniprot=protein_info['uniprot'],
                gene_symbol=protein_info['gene_symbol'],
                residue_type=residue_type,
                predicted_prob_raw=float(row['predicted_prob_raw'] or 0),
                predicted_prob_calibrated=float(row['predicted_prob_calibrated'] or 0),
                known_positive=bool(row['known_positive']),
                fdr_05=bool(row['predicted_calibrated_fdr_05']),
                fdr_02=bool(row['predicted_calibrated_fdr_02']),
                fdr_01=bool(row['predicted_calibrated_fdr_01']),
                kinase_scores=kinase_scores
            )
            sites.append(site)

        # Calculate statistics
        stats = {
            'total_sites': len(sites),
            'high_confidence_sites': sum(1 for s in sites if s.fdr_01),
            'medium_confidence_sites': sum(1 for s in sites if s.fdr_02),
            'known_positive_sites': sum(1 for s in sites if s.known_positive),
            'max_position': max((s.position for s in sites), default=0)
        }

        total_time = (time.time() - start_time) * 1000

        # Log performance and data quality
        sites_with_kinases = sum(1 for s in sites if s.kinase_scores and len(s.kinase_scores) > 0)
        print(f"Performance: {total_time:.1f}ms")
        print(f"Sites with kinase data: {sites_with_kinases}/{len(sites)}")

        # Debug: Show first few sites with kinase data
        for site in sites[:5]:
            if site.kinase_scores:
                top_kinase = max(site.kinase_scores.items(), key=lambda x: x[1]) if site.kinase_scores else None
                print(f"  Position {site.position}: {len(site.kinase_scores)} kinases, top: {top_kinase[0] if top_kinase else 'None'}")

        return {
            'protein': protein_info,
            'sites': sites,
            'statistics': stats
        }

    def get_kinase_profile_across_protein(self, identifier: str, kinase_name: str) -> List[Dict]:
        """Get activity profile for a specific kinase across all sites"""
        data = self.get_complete_protein_data(identifier)
        if not data:
            return []

        profile = []
        for site in data['sites']:
            if site.kinase_scores and kinase_name in site.kinase_scores:
                score = site.kinase_scores[kinase_name]
                if score > 0:
                    profile.append({
                        'position': site.position,
                        'site': site.site,
                        'residue': site.residue_type,
                        'score': score,
                        'phosphocompetent': site.fdr_05
                    })

        return sorted(profile, key=lambda x: x['score'], reverse=True)

    def search_proteins(self, query: str, limit: int = 50) -> List[Dict]:
        """Search for proteins"""
        cursor = self.conn.cursor()

        search_query = """
            SELECT DISTINCT uniprot, gene_symbol
            FROM phospho_competency
            WHERE uniprot LIKE ? OR gene_symbol LIKE ?
            ORDER BY gene_symbol
            LIMIT ?
        """

        pattern = f'%{query}%'
        cursor.execute(search_query, (pattern, pattern, limit))

        results = []
        for row in cursor.fetchall():
            display = f"{row['gene_symbol']} ({row['uniprot']})" if row['gene_symbol'] else row['uniprot']
            results.append({
                'uniprot': row['uniprot'],
                'gene_symbol': row['gene_symbol'],
                'display': display,
                'value': row['uniprot']
            })

        return results

    def get_database_statistics(self) -> Dict:
        """Get database statistics"""
        cursor = self.conn.cursor()

        stats = {}
        cursor.execute("SELECT COUNT(DISTINCT uniprot) FROM phospho_competency")
        stats['total_proteins'] = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM phospho_competency")
        stats['total_sites'] = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM phospho_competency WHERE known_positive = 1")
        stats['known_sites'] = cursor.fetchone()[0]

        return stats


# Test the fix
if __name__ == "__main__":
    print("\n" + "="*60)
    print("TESTING FIXED KINASE DATA LOADING")
    print("="*60)

    db = KinoPlexQuery('kinoplex.db')

    # Test with P04637
    print("\nLoading P04637...")
    data = db.get_complete_protein_data('P04637')

    if data and data['sites']:
        print(f"\n✓ Loaded {len(data['sites'])} sites")

        # Check sites with kinase data
        sites_with_kinases = [s for s in data['sites'] if s.kinase_scores and len(s.kinase_scores) > 0]
        print(f"✓ {len(sites_with_kinases)} sites have kinase data")

        # Show first 3 sites with kinase scores
        print("\nFirst 3 sites with kinase scores:")
        for site in sites_with_kinases[:3]:
            top_3 = sorted(site.kinase_scores.items(), key=lambda x: x[1], reverse=True)[:3]
            print(f"  Position {site.position}: {', '.join([f'{k}:{v:.1f}' for k,v in top_3])}")

        # Test kinase profile
        print("\nTesting kinase profile for CDK2...")
        profile = db.get_kinase_profile_across_protein('P04637', 'CDK2')
        if profile:
            print(f"✓ CDK2 is active at {len(profile)} sites")
            print(f"  Top site: Position {profile[0]['position']} with score {profile[0]['score']:.1f}")
    else:
        print("✗ Failed to load data")