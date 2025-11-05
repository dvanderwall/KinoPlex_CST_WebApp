# KinoPlex Web Application

A next-generation phosphorylation prediction and visualization platform powered by structure-based machine learning and comprehensive kinase specificity profiling.

## 🧬 Overview

KinoPlex is a Flask-based web application that provides an interactive platform for exploring phosphorylation site predictions and kinase specificity across the human proteome. The application combines AlphaFold structural predictions with machine learning to predict which sites can be phosphorylated and which kinases are likely responsible, presenting the data through sophisticated D3.js visualizations.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend Layer                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   HTML/CSS   │  │  JavaScript  │  │    D3.js     │ │
│  │  Templates   │  │   (search,   │  │(visualization)│ │
│  │              │  │   main)      │  │              │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
                           ↕
┌─────────────────────────────────────────────────────────┐
│                    Flask Application                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Routes     │  │   API        │  │   Views      │ │
│  │   (app.py)   │  │  Endpoints   │  │  (templates) │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
                           ↕
┌─────────────────────────────────────────────────────────┐
│                     Data Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  SQLite DB   │  │   UniProt    │  │  KinoPlex    │ │
│  │(kinoplex.db) │  │   API        │  │    Query     │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
kinoplex/
├── app.py                      # Main Flask application and routing
├── db_build.py                 # Database construction script
├── kinoplex_query.py          # Optimized database query interface
├── uniprot_integration.py     # UniProt API client
├── requirements.txt           # Python dependencies
├── kinoplex.db               # SQLite database (generated)
│
├── static/
│   ├── css/
│   │   └── style.css         # Enhanced dark-themed UI styles
│   └── js/
│       ├── main.js           # Common functionality
│       ├── search.js         # Protein search & autocomplete
│       └── visualization.js  # D3.js integrated visualization
│
└── templates/
    ├── base.html             # Base template with navigation
    ├── index.html            # Landing page with search
    ├── protein.html          # Protein visualization page
    ├── about.html            # About page
    └── error.html            # Error handling page
```

## 🔧 Core Components

### Backend Components

| File | Purpose | Key Features |
|------|---------|--------------|
| **app.py** | Flask application server | • RESTful API endpoints<br>• Route handling<br>• Error management |
| **kinoplex_query.py** | Database interface | • Optimized queries (<200ms)<br>• JSON kinase storage<br>• Composite indexing |
| **uniprot_integration.py** | UniProt API client | • Protein data retrieval<br>• Sequence motif extraction<br>• Response caching |
| **db_build.py** | Database builder | • Loads 1.7M+ phosphosites<br>• Creates optimized indexes<br>• JSON conversion for kinases |

### Frontend Components

| File | Purpose | Key Features |
|------|---------|--------------|
| **visualization.js** | D3.js visualizations | • Integrated lollipop plots<br>• Sequence strip viewer<br>• Export capabilities |
| **search.js** | Search interface | • Debounced autocomplete<br>• Keyboard navigation<br>• ~100ms response time |
| **style.css** | Visual design | • Dark theme<br>• Glassmorphism effects<br>• CSS variables system |

## 🚀 Quick Start

### Prerequisites

- Python 3.8+
- SQLite3 with JSON1 extension
- Modern web browser (Chrome 90+, Firefox 88+, Safari 14+)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/kinoplex.git
cd kinoplex
```

2. **Install dependencies**
```bash
pip install -r requirements.txt
```

3. **Build the database** (requires source feather files)
```bash
# Update paths in db_build.py to point to your feather files
python db_build.py
```

4. **Run the application**
```bash
python app.py
```

5. **Access the application**
```
http://localhost:5000
```

## 📊 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Landing page with search |
| `/protein/<identifier>` | GET | Protein visualization page |
| `/api/search` | GET | Autocomplete search |
| `/api/protein/<identifier>` | GET | Complete phosphorylation data |
| `/api/protein/<identifier>/sequence` | GET | Protein sequence |
| `/api/protein/<identifier>/site/<position>/motif` | GET | Sequence motif (±7 residues) |
| `/api/protein/<identifier>/kinase/<kinase_name>` | GET | Kinase-specific profile |
| `/api/stats` | GET | Database statistics |

## ⚡ Performance Metrics

- **Database Queries**: <200ms (reduced from 12s through optimization)
- **Autocomplete Response**: ~100ms
- **Page Load**: <1s for typical proteins
- **Visualization Render**: 300-500ms for 100+ sites
- **UniProt API**: 500ms-2s (cached after first request)

## 🎨 Features

### Search & Navigation
- Real-time autocomplete with debouncing
- Support for UniProt IDs and gene symbols
- Keyboard navigation support
- Example proteins for quick exploration

### Visualization
- **Lollipop Plot**: Phosphorylation probability visualization
- **Sequence Strip**: Interactive amino acid sequence viewer
- **Zoom Controls**: Region selection and focusing
- **Dynamic Filtering**: FDR thresholds, residue types, known sites

### Data Analysis
- Kinase specificity predictions for 400+ kinases
- Multiple confidence thresholds (1%, 2%, 5% FDR)
- Sequence motif extraction (±7 residues)
- Export to CSV, JSON, SVG, and PNG

### User Interface
- Modern dark theme with glassmorphism effects
- Smooth animations and transitions
- Responsive design (optimized for desktop)
- Comprehensive tooltips and help text

## 🗄️ Database Schema

```sql
-- Core prediction data
phospho_competency (
    id INTEGER PRIMARY KEY,
    uniprot TEXT,
    gene_symbol TEXT,
    site TEXT,
    position INTEGER,
    predicted_prob_raw REAL,
    predicted_prob_calibrated REAL,
    known_positive INTEGER,
    predicted_calibrated_fdr_05 INTEGER,
    predicted_calibrated_fdr_02 INTEGER,
    predicted_calibrated_fdr_01 INTEGER
)

-- S/T kinase specificity (JSON storage)
st_kinase_specificity (
    id INTEGER PRIMARY KEY,
    uniprot TEXT,
    gene_symbol TEXT,
    site TEXT,
    position INTEGER,
    kinase_data TEXT  -- JSON with 303 kinase scores
)

-- Y kinase specificity (JSON storage)
y_kinase_specificity (
    id INTEGER PRIMARY KEY,
    uniprot TEXT,
    gene_symbol TEXT,
    site TEXT,
    position INTEGER,
    kinase_data TEXT  -- JSON with 78 kinase scores
)

-- Key Indexes for Performance
CREATE INDEX idx_phospho_uniprot ON phospho_competency(uniprot);
CREATE INDEX idx_phospho_gene ON phospho_competency(gene_symbol);
CREATE INDEX idx_phospho_uniprot_position ON phospho_competency(uniprot, position);
-- Similar indexes for kinase tables
```

## 🔑 Key Technical Decisions

1. **SQLite over PostgreSQL**: Sufficient performance with proper indexing, simpler deployment
2. **JSON Storage for Kinase Scores**: Flexible storage without 400+ columns, enables dynamic retrieval
3. **Integrated Visualization**: Single SVG with foreignObject for HTML embedding provides perfect alignment
4. **Client-Side Filtering**: Instant feedback, reduced server load
5. **Composite Indexes**: Critical for sub-second queries on 1.7M+ records
6. **Debounced Autocomplete**: 300ms delay prevents API flooding during typing

## 📦 Dependencies

### Backend
```
Flask==3.0.0
pandas==2.1.3
pyarrow==14.0.1
requests==2.31.0
```

### Frontend
- D3.js v7
- Inter font family (Google Fonts)
- Modern CSS features (Grid, Flexbox, CSS Variables)

## 🧪 Development

### Configuration

Key configuration points in the codebase:

```python
# app.py
app.config['SECRET_KEY'] = 'your-secret-key-here'  # Change in production

# kinoplex_query.py
def __init__(self, db_path: str = 'kinoplex.db'):
    self.db_path = db_path  # Database location

# uniprot_integration.py
self.base_url = "https://rest.uniprot.org/uniprotkb"  # UniProt API

# db_build.py - Update these paths to your data files
phospho_path = '/path/to/Total_Phosphocompetency_STY.feather'
st_pssm_path = '/path/to/ST_PSSM_Percentiles.feather'
y_pssm_path = '/path/to/Y_PSSM_Percentiles.feather'
```

### Testing

Run with Flask debug mode for development:
```python
app.run(debug=True, host='0.0.0.0', port=5000)
```

### Database Building

The database must be built from source feather files containing:
1. Total phosphocompetency predictions for all STY sites
2. S/T kinase PSSM percentiles
3. Y kinase PSSM percentiles

Update the file paths in `db_build.py` and run:
```bash
python db_build.py
```

## 📈 Data Flow

```
1. User Search
   ├── Debounced input (300ms)
   └── API autocomplete request (/api/search)
   
2. Protein Selection
   ├── Load protein data (kinoplex_query.py)
   ├── Fetch UniProt info (uniprot_integration.py)
   └── Retrieve sequence (/api/protein/{id}/sequence)
   
3. Visualization
   ├── D3.js rendering (visualization.js)
   ├── Interactive elements (lollipops + sequence)
   └── Real-time filtering (client-side)
   
4. Analysis
   ├── Site selection (click interaction)
   ├── Kinase profiles (/api/protein/{id}/kinase/{name})
   └── Data export (CSV, JSON, SVG, PNG)
```

## 🎯 Architecture Highlights

- **Separation of Concerns**: Clear separation between data, logic, and presentation layers
- **Performance First**: Database optimizations reduce query time by 98%
- **Modern UI/UX**: Glassmorphism effects, smooth animations, intuitive interactions
- **Extensible API**: RESTful endpoints enable future mobile apps or third-party integrations
- **Scientific Accuracy**: Maintains biological distinction between kinase families throughout
- **Intelligent Caching**: UniProt responses cached in memory to minimize API calls
- **Responsive Visualization**: D3.js plots adapt to container size and data density

## 🔒 Security Considerations

- Change Flask `SECRET_KEY` in production
- Implement rate limiting for API endpoints
- Consider adding authentication for data export features
- Validate all user inputs against SQL injection
- Use HTTPS in production deployment

## 🚢 Deployment

For production deployment:

1. Use a production WSGI server (gunicorn, uWSGI)
2. Set up reverse proxy (nginx, Apache)
3. Configure proper logging
4. Set environment variables for secrets
5. Consider using PostgreSQL for multi-user scenarios

Example gunicorn deployment:
```bash
gunicorn -w 4 -b 0.0.0.0:8000 app:app
```

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📚 Citation

If you use KinoPlex in your research, please cite:

```
Vanderwall DR, Huttlin EL, Mintseris J, et al. 
"A structural atlas decodes kinase specificity across the human proteome" 
(Manuscript in review)
```

## 🔗 Links

- [Cell Signaling Technology](https://www.cellsignal.com)
- [Harvard Medical School](https://hms.harvard.edu)
- [Dana-Farber Cancer Institute](https://www.dana-farber.org)

## 👥 Contact

For questions about the web application:
- **Technical Implementation**: David Vanderwall - dvanderwall@hms.harvard.edu
- **Principal Investigators**: 
  - Steven P. Gygi, PhD - Harvard Medical School
  - Lewis C. Cantley, PhD - Dana-Farber Cancer Institute

## 🙏 Acknowledgments

- Cell Signaling Technology for hosting and support
- Harvard Medical School Department of Cell Biology
- Dana-Farber Cancer Institute
- Boston Children's Hospital
- The Gygi and Cantley laboratory members

---

*KinoPlex - Illuminating the dark phosphoproteome through structure and machine learning*