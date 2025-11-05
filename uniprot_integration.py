"""
UniProt Integration Module for KinoPlex
Retrieves protein information and sequences from the UniProt REST API

This module provides functions to fetch comprehensive protein data from UniProt,
including functional descriptions, gene names, organism information, and most
importantly, the complete amino acid sequence that we need for motif analysis.

The UniProt API is well-documented at: https://www.uniprot.org/help/api
We use their REST API which returns data in JSON format for easy parsing.
"""

import requests
from typing import Optional, Dict
import time


class UniProtClient:
    """
    Client for interacting with the UniProt REST API.

    This class handles all communication with UniProt, including error handling,
    rate limiting (to be respectful of their servers), and data caching to avoid
    redundant requests. UniProt's API is generally fast and reliable, but we
    still want to minimize requests both for performance and courtesy.
    """

    def __init__(self):
        """Initialize the UniProt client with base URL and cache."""
        self.base_url = "https://rest.uniprot.org/uniprotkb"
        # Simple in-memory cache for this session
        # In production, you might use Redis or file-based caching
        self._cache = {}

    def get_protein_info(self, uniprot_id: str) -> Optional[Dict]:
        try:
            url = f"{self.base_url}/{uniprot_id}.json"
            response = requests.get(url, timeout=10)

            if response.status_code == 404:
                return None
            elif response.status_code != 200:
                print(f"UniProt API error: {response.status_code}")  # This might be failing silently
                return None

            data = response.json()
            protein_info = self._parse_uniprot_data(data)

            return protein_info

        except requests.RequestException as e:
            print(f"Error fetching UniProt data: {e}")  # Check if this is being printed
            return None

    def _parse_uniprot_data(self, data: Dict) -> Dict:
        """
        Parse the complex UniProt JSON response into a simpler structure.

        UniProt's JSON format is comprehensive but deeply nested. This function
        extracts the specific fields we care about and puts them in a flat
        dictionary that's easier to work with in our application.

        Args:
            data: Raw JSON response from UniProt API

        Returns:
            Simplified dictionary with key protein information
        """
        # Extract accession (UniProt ID)
        accession = data.get('primaryAccession', 'Unknown')

        # Extract gene name (preferred name)
        gene_name = 'N/A'
        if 'genes' in data and len(data['genes']) > 0:
            gene_data = data['genes'][0]
            if 'geneName' in gene_data:
                gene_name = gene_data['geneName'].get('value', 'N/A')

        # Extract protein name (recommended name)
        protein_name = 'Unknown protein'
        if 'proteinDescription' in data:
            desc = data['proteinDescription']
            if 'recommendedName' in desc:
                protein_name = desc['recommendedName'].get('fullName', {}).get('value', protein_name)

        # Extract organism
        organism = 'Unknown'
        if 'organism' in data:
            organism = data['organism'].get('scientificName', 'Unknown')
            # Add common name in parentheses if available
            common_name = data['organism'].get('commonName')
            if common_name:
                organism = f"{organism} ({common_name})"

        # Extract function (comments with type "FUNCTION")
        function = 'No functional annotation available.'
        if 'comments' in data:
            for comment in data['comments']:
                if comment.get('commentType') == 'FUNCTION':
                    # Function text is in the 'texts' array
                    if 'texts' in comment and len(comment['texts']) > 0:
                        function = comment['texts'][0].get('value', function)
                    break

        # Extract the amino acid sequence
        # This is crucial for our motif analysis feature
        sequence = ''
        seq_length = 0
        if 'sequence' in data:
            sequence = data['sequence'].get('value', '')
            seq_length = data['sequence'].get('length', len(sequence))

        return {
            'accession': accession,
            'gene_name': gene_name,
            'protein_name': protein_name,
            'organism': organism,
            'function': function,
            'sequence': sequence,
            'length': seq_length
        }

    def get_sequence_motif(self, uniprot_id: str, position: int,
                           window: int = 7) -> Optional[str]:
        """
        Extract the sequence motif around a phosphorylation site.

        Kinase recognition is determined by the amino acids surrounding the
        phosphorylation site, not just the serine, threonine, or tyrosine itself.
        Kinases recognize specific sequence patterns (motifs) typically extending
        about 7 residues in each direction from the target residue. For example,
        Akt kinases prefer R-x-R-x-x-S/T, while Casein Kinase II prefers S/T-x-x-E.

        This function extracts the sequence context around a site, which researchers
        can use to understand why specific kinases are predicted to target it.

        Args:
            uniprot_id: UniProt accession
            position: Position of the phosphorylation site (1-indexed)
            window: Number of residues to include on each side (default 7)

        Returns:
            Sequence motif as a string, or None if extraction fails

        Example:
            For position 15 in TP53, with window=7:
            Returns: "PSVEPPLSQETFSGL"
                      ^^^^^^^S^^^^^^^
                      (S at position 15 in the center)
        """
        # Get the full sequence (from cache if available)
        protein_info = self.get_protein_info(uniprot_id)

        if not protein_info or not protein_info.get('sequence'):
            return None

        sequence = protein_info['sequence']

        # Convert to 0-indexed for Python string slicing
        # UniProt positions are 1-indexed (first amino acid is position 1)
        zero_based_pos = position - 1

        # Calculate start and end positions for the motif
        # We want [position - window : position + window + 1] to include the site
        start = max(0, zero_based_pos - window)
        end = min(len(sequence), zero_based_pos + window + 1)

        # Extract the motif
        motif = sequence[start:end]

        return motif

    def get_residue_at_position(self, uniprot_id: str, position: int) -> Optional[str]:
        """
        Get the amino acid residue at a specific position.

        This is useful for validation - we can verify that the predicted
        phosphorylation site actually corresponds to a serine, threonine,
        or tyrosine in the sequence. If it doesn't, something is wrong with
        either the prediction data or the sequence version.

        Args:
            uniprot_id: UniProt accession
            position: Position in the sequence (1-indexed)

        Returns:
            Single letter amino acid code, or None if position invalid
        """
        protein_info = self.get_protein_info(uniprot_id)

        if not protein_info or not protein_info.get('sequence'):
            return None

        sequence = protein_info['sequence']

        # Convert to 0-indexed
        zero_based_pos = position - 1

        # Check if position is valid
        if zero_based_pos < 0 or zero_based_pos >= len(sequence):
            return None

        return sequence[zero_based_pos]


# Create a singleton instance for use throughout the application
# This ensures we maintain a single cache across all requests
uniprot_client = UniProtClient()


def get_protein_data(uniprot_id: str) -> Optional[Dict]:
    """
    Convenience function to get protein information.
    This is the main function other modules should use.
    """
    return uniprot_client.get_protein_info(uniprot_id)


def get_sequence_motif(uniprot_id: str, position: int, window: int = 7) -> Optional[str]:
    """
    Convenience function to get sequence motif around a site.
    This is used when displaying site details to show the sequence context.
    """
    return uniprot_client.get_sequence_motif(uniprot_id, position, window)