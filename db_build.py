"""
KinoPlex Database Builder
Creates an optimized SQLite database for phosphorylation site visualization

This script reads phospho-competency and kinase specificity data from feather files
and creates a well-indexed SQLite database for rapid querying in the web application.
"""

import pandas as pd
import sqlite3
from pathlib import Path
import time

class KinoPlexDatabaseBuilder:
    """
    Builds and manages the KinoPlex SQLite database with optimized indexes
    for protein-based queries.
    """
    
    def __init__(self, db_path='kinoplex.db'):
        """
        Initialize the database builder.
        
        Args:
            db_path: Path where the SQLite database will be created
        """
        self.db_path = db_path
        self.conn = None
        
    def connect(self):
        """Establish database connection"""
        self.conn = sqlite3.connect(self.db_path)
        return self.conn
    
    def close(self):
        """Close database connection"""
        if self.conn:
            self.conn.close()
            
    def create_tables(self):
        """
        Create the database schema with three main tables:
        1. phospho_competency: Structure-based phosphorylation predictions
        2. st_kinase_specificity: Serine/Threonine kinase PSSM percentiles
        3. y_kinase_specificity: Tyrosine kinase PSSM percentiles
        """
        cursor = self.conn.cursor()
        
        # Table 1: Phospho-competency data
        # This stores the core phosphorylation predictions for all STY sites
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS phospho_competency (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uniprot TEXT NOT NULL,
                gene_symbol TEXT,
                site TEXT NOT NULL,
                position INTEGER NOT NULL,
                known_positive INTEGER,
                predicted_prob_raw REAL,
                predicted_prob_calibrated REAL,
                predicted_calibrated_fdr_05 INTEGER,
                predicted_calibrated_fdr_02 INTEGER,
                predicted_calibrated_fdr_01 INTEGER
            )
        ''')
        
        print("✓ Created phospho_competency table")
        
        # Table 2: S/T Kinase Specificity
        # Wide format with one column per kinase - optimized for retrieving all kinases at once
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS st_kinase_specificity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uniprot TEXT NOT NULL,
                gene_symbol TEXT,
                site TEXT NOT NULL,
                position INTEGER NOT NULL,
                kinase_data TEXT NOT NULL
            )
        ''')
        
        print("✓ Created st_kinase_specificity table")
        
        # Table 3: Y Kinase Specificity
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS y_kinase_specificity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uniprot TEXT NOT NULL,
                gene_symbol TEXT,
                site TEXT NOT NULL,
                position INTEGER NOT NULL,
                kinase_data TEXT NOT NULL
            )
        ''')
        
        print("✓ Created y_kinase_specificity table")
        
        self.conn.commit()
        
    def create_indexes(self):
        """
        Create strategic indexes for fast querying.
        
        Key indexes:
        - UniProt ID: Primary query field for users
        - Gene Symbol: Alternative query field
        - Composite indexes on (uniprot, position): For ordered retrieval of sites
        """
        cursor = self.conn.cursor()
        
        print("\nCreating indexes for optimal query performance...")
        
        # Indexes for phospho_competency table
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_phospho_uniprot 
            ON phospho_competency(uniprot)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_phospho_gene 
            ON phospho_competency(gene_symbol)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_phospho_uniprot_position 
            ON phospho_competency(uniprot, position)
        ''')
        
        # Indexes for ST kinase specificity
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_st_uniprot 
            ON st_kinase_specificity(uniprot)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_st_gene 
            ON st_kinase_specificity(gene_symbol)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_st_uniprot_position 
            ON st_kinase_specificity(uniprot, position)
        ''')
        
        # Indexes for Y kinase specificity
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_y_uniprot 
            ON y_kinase_specificity(uniprot)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_y_gene 
            ON y_kinase_specificity(gene_symbol)
        ''')
        
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_y_uniprot_position 
            ON y_kinase_specificity(uniprot, position)
        ''')
        
        self.conn.commit()
        print("✓ All indexes created successfully")
        
    def load_phospho_competency(self, feather_path):
        """
        Load phospho-competency data from feather file into database.
        
        Args:
            feather_path: Path to the Total_Phosphocompetency_STY.feather file
        """
        print(f"\nLoading phospho-competency data from {feather_path}...")
        start_time = time.time()
        
        # Read the feather file
        df = pd.read_feather(feather_path)
        
        # Clean column names to match our schema
        df.columns = [col.lower().replace(' ', '_') for col in df.columns]
        
        # Convert boolean columns to integer if needed
        bool_cols = ['knownpositive', 'predicted_calibrated_fdr_05', 
                     'predicted_calibrated_fdr_02', 'predicted_calibrated_fdr_01']
        for col in bool_cols:
            if col in df.columns:
                df[col] = df[col].astype(int)
        
        # CRITICAL: Ensure position is a proper Python int, not numpy int64 or pandas nullable Int64
        # This prevents SQLite from storing object references instead of actual integers
        if 'position' in df.columns:
            df['position'] = df['position'].astype('int64').astype(int)
        
        # Select and rename columns to match our schema
        column_mapping = {
            'uniprot': 'uniprot',
            'genesymbol': 'gene_symbol',
            'site': 'site',
            'position': 'position',
            'knownpositive': 'known_positive',
            'predictedprob_raw': 'predicted_prob_raw',
            'predictedprob_calibrated': 'predicted_prob_calibrated',
            'predicted_calibrated_fdr_05': 'predicted_calibrated_fdr_05',
            'predicted_calibrated_fdr_02': 'predicted_calibrated_fdr_02',
            'predicted_calibrated_fdr_01': 'predicted_calibrated_fdr_01'
        }
        
        df_clean = df.rename(columns=column_mapping)
        df_clean = df_clean[[col for col in column_mapping.values() if col in df_clean.columns]]
        
        # Insert into database
        df_clean.to_sql('phospho_competency', self.conn, if_exists='append', index=False)
        
        elapsed = time.time() - start_time
        print(f"✓ Loaded {len(df_clean):,} phosphorylation sites in {elapsed:.2f} seconds")
        
    def load_kinase_specificity(self, feather_path, table_name):
        """
        Load kinase specificity data from feather file into database.
        
        Instead of creating hundreds of columns, we store kinase scores as JSON
        for flexible retrieval and visualization.
        
        Args:
            feather_path: Path to the PSSM percentile feather file
            table_name: Either 'st_kinase_specificity' or 'y_kinase_specificity'
        """
        print(f"\nLoading kinase specificity data from {feather_path}...")
        start_time = time.time()
        
        # Read the feather file
        df = pd.read_feather(feather_path)
        
        # First 4 columns are metadata, rest are kinase scores
        metadata_cols = df.columns[:4].tolist()
        kinase_cols = df.columns[4:].tolist()
        
        print(f"  Found {len(kinase_cols)} kinases in dataset")
        
        # Convert kinase columns to JSON format for storage
        # This allows flexible retrieval and keeps the database normalized
        import json
        
        def row_to_kinase_json(row):
            """Convert kinase percentile scores to JSON string"""
            kinase_dict = {kinase: float(row[kinase]) for kinase in kinase_cols}
            return json.dumps(kinase_dict)
        
        # Create a clean dataframe for insertion
        df_insert = pd.DataFrame({
            'uniprot': df[df.columns[0]],
            'gene_symbol': df[df.columns[1]],
            'site': df[df.columns[2]],
            'position': df[df.columns[3]].astype('int64').astype(int),  # Ensure proper Python int
            'kinase_data': df.apply(row_to_kinase_json, axis=1)
        })
        
        # Insert into database
        df_insert.to_sql(table_name, self.conn, if_exists='append', index=False)
        
        elapsed = time.time() - start_time
        print(f"✓ Loaded {len(df_insert):,} sites with kinase specificity in {elapsed:.2f} seconds")
        
    def build_database(self, phospho_path, st_pssm_path, y_pssm_path):
        """
        Complete database build process.
        
        Args:
            phospho_path: Path to phospho-competency feather file
            st_pssm_path: Path to S/T PSSM percentiles feather file
            y_pssm_path: Path to Y PSSM percentiles feather file
        """
        print("=" * 70)
        print("KinoPlex Database Builder")
        print("=" * 70)
        
        try:
            # Connect to database
            self.connect()
            
            # Create schema
            print("\n[1/5] Creating database schema...")
            self.create_tables()
            
            # Load phospho-competency data
            print("\n[2/5] Loading phosphorylation competency data...")
            self.load_phospho_competency(phospho_path)
            
            # Load S/T kinase specificity
            print("\n[3/5] Loading S/T kinase specificity data...")
            self.load_kinase_specificity(st_pssm_path, 'st_kinase_specificity')
            
            # Load Y kinase specificity
            print("\n[4/5] Loading Y kinase specificity data...")
            self.load_kinase_specificity(y_pssm_path, 'y_kinase_specificity')
            
            # Create indexes
            print("\n[5/5] Creating indexes for fast querying...")
            self.create_indexes()
            
            # Optimize database
            print("\nOptimizing database...")
            self.conn.execute("VACUUM")
            self.conn.execute("ANALYZE")
            
            print("\n" + "=" * 70)
            print("✓ Database build complete!")
            print(f"✓ Database saved to: {self.db_path}")
            print("=" * 70)
            
            # Print database statistics
            self.print_statistics()
            
        except Exception as e:
            print(f"\n✗ Error building database: {e}")
            raise
        finally:
            self.close()
            
    def print_statistics(self):
        """Print helpful statistics about the database"""
        cursor = self.conn.cursor()
        
        print("\nDatabase Statistics:")
        print("-" * 70)
        
        # Count rows in each table
        cursor.execute("SELECT COUNT(*) FROM phospho_competency")
        phospho_count = cursor.fetchone()[0]
        print(f"  Phospho-competency sites: {phospho_count:,}")
        
        cursor.execute("SELECT COUNT(*) FROM st_kinase_specificity")
        st_count = cursor.fetchone()[0]
        print(f"  S/T kinase sites: {st_count:,}")
        
        cursor.execute("SELECT COUNT(*) FROM y_kinase_specificity")
        y_count = cursor.fetchone()[0]
        print(f"  Y kinase sites: {y_count:,}")
        
        # Count unique proteins
        cursor.execute("SELECT COUNT(DISTINCT uniprot) FROM phospho_competency")
        unique_proteins = cursor.fetchone()[0]
        print(f"  Unique proteins: {unique_proteins:,}")
        
        # Database file size
        db_size = Path(self.db_path).stat().st_size / (1024 * 1024)
        print(f"  Database size: {db_size:.2f} MB")
        

def main():
    """Main execution function"""
    
    # Define file paths
    # NOTE: Update these paths to match your actual file locations
    phospho_path = '/Users/davidvanderwall/Desktop/Total_Phosphocompetency_STY.feather'
    st_pssm_path = '/Users/davidvanderwall/Desktop/ST_PSSM_Percentiles.feather'
    y_pssm_path = '/Users/davidvanderwall/Desktop/Y_PSSM_Percentiles.feather'
    
    # Create database
    builder = KinoPlexDatabaseBuilder(db_path='kinoplex.db')
    builder.build_database(phospho_path, st_pssm_path, y_pssm_path)
    

if __name__ == '__main__':
    main()