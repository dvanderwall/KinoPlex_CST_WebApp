/**
 * KinoPlex Integrated Visualization - Enhanced with Download Features
 *
 * This creates a unified visualization panel with three coordinated layers:
 * 1. Top: Lollipop plot showing phosphorylation probabilities
 * 2. Middle: X-axis with position labels
 * 3. Bottom: Scrollable sequence strip with amino acid letters
 *
 * ENHANCED: Added download capabilities for the plot and kinase profiles
 */

(function() {
    'use strict';

    if (typeof PROTEIN_ID === 'undefined') {
        console.log('Not on protein page, skipping visualization initialization');
        return;
    }

    // Global state management
    let proteinData = null;
    let proteinSequence = null;
    let currentFDRThreshold = 0.05;
    let currentResidueFilter = 'all';
    let showKnownOnly = false;
    let highlightedSiteId = null;  // Track which site is currently highlighted

    // Zoom state for focusing on specific regions
    let viewportStart = null;
    let viewportEnd = null;

    // D3 visualization objects
    let svg, plotGroup, xScale, yScale, tooltip;

    // Dimensions - the plot maintains a fixed width for stability
    const margin = { top: 40, right: 40, bottom: 180, left: 80 }; // Extra space for sequence strip
    let width, height;

    /**
     * Initialize the entire visualization system
     */
    function init() {
        console.log('Initializing integrated visualization for protein:', PROTEIN_ID);

        setupControls();
        calculateDimensions();
        loadProteinData();

        // Respond to window resizing by recalculating and redrawing
        window.addEventListener('resize', debounce(handleResize, 250));
    }

    /**
     * Set up event listeners for all interactive controls
     */
    function setupControls() {
        // FDR threshold buttons - these control the stringency of our predictions
        document.querySelectorAll('[data-fdr]').forEach(button => {
            button.addEventListener('click', function() {
                // Update visual state of buttons
                document.querySelectorAll('[data-fdr]').forEach(b => b.classList.remove('active'));
                this.classList.add('active');

                // Store the new threshold and update the visualization
                currentFDRThreshold = parseFloat(this.getAttribute('data-fdr'));
                updateVisualization();
            });
        });

        // Residue type filters - show only S, T, Y, or all residues
        document.querySelectorAll('[data-residue]').forEach(button => {
            button.addEventListener('click', function() {
                document.querySelectorAll('[data-residue]').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                currentResidueFilter = this.getAttribute('data-residue');
                updateVisualization();
            });
        });

        // Known sites only checkbox - filter to show only experimentally validated sites
        const knownOnlyCheckbox = document.getElementById('showKnownOnly');
        if (knownOnlyCheckbox) {
            knownOnlyCheckbox.addEventListener('change', function() {
                showKnownOnly = this.checked;
                updateVisualization();
            });
        }

        // Panel and export controls
        document.getElementById('closePanelButton')?.addEventListener('click', hideSiteDetailsPanel);

        // Original export buttons
        document.getElementById('exportCSV')?.addEventListener('click', function() {
            console.log('CSV export button clicked');
            exportAsCSV();
        });

        document.getElementById('exportJSON')?.addEventListener('click', function() {
            console.log('JSON export button clicked');
            exportAsJSON();
        });

        // NEW: Enhanced export controls
        document.getElementById('exportPlotSVG')?.addEventListener('click', function() {
            console.log('SVG export button clicked');
            exportPlotAsSVG();
        });

        document.getElementById('exportPlotPNG')?.addEventListener('click', function() {
            console.log('PNG export button clicked');
            exportPlotAsPNG();
        });

        document.getElementById('exportKinaseProfile')?.addEventListener('click', function() {
            console.log('Kinase profile export button clicked');
            exportKinaseProfileData();
        });

        // Zoom controls for focusing on specific regions
        document.getElementById('zoomReset')?.addEventListener('click', resetZoom);
        document.getElementById('zoomToSelection')?.addEventListener('click', enableSelectionMode);
    }

    /**
     * Calculate dimensions based on the container size
     */
    function calculateDimensions() {
        const container = document.getElementById('lollipopPlot');
        if (!container) return;

        const containerWidth = container.clientWidth;
        width = containerWidth - margin.left - margin.right;
        height = 400 - margin.top - margin.bottom; // Fixed height for the lollipop portion
    }

    /**
     * Load protein data from the server
     */
    async function loadProteinData() {
        try {
            // Fetch the phosphorylation predictions
            const response = await fetch(`/api/protein/${PROTEIN_ID}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            proteinData = data;
            console.log(`Loaded ${data.sites.length} sites for protein ${PROTEIN_ID}`);

            // Fetch the amino acid sequence
            await loadProteinSequence();

            // Now that we have all the data, create the visualization
            createVisualization();

            // Set up the kinase dropdown for profile viewing
            populateKinaseDropdown();

        } catch (error) {
            console.error('Failed to load protein data:', error);
            showError('Failed to load protein data. Please try again.');
        }
    }

    /**
     * Load the protein sequence from UniProt via our backend
     */
    async function loadProteinSequence() {
        try {
            const response = await fetch(`/api/protein/${PROTEIN_ID}/sequence`);

            if (response.ok) {
                const data = await response.json();
                proteinSequence = data.sequence;
                console.log(`Loaded sequence of length ${data.length}`);
            } else {
                // Fall back to placeholder if the endpoint doesn't exist
                console.warn('Sequence endpoint not available, using placeholder');
                const maxPosition = Math.max(...proteinData.sites.map(s => s.position));
                proteinSequence = generatePlaceholderSequence(maxPosition);
            }

        } catch (error) {
            console.warn('Failed to fetch sequence, using placeholder:', error);
            const maxPosition = Math.max(...proteinData.sites.map(s => s.position));
            proteinSequence = generatePlaceholderSequence(maxPosition);
        }
    }

    /**
     * Generate a random amino acid sequence for development
     */
    function generatePlaceholderSequence(length) {
        const amino_acids = 'ACDEFGHIKLMNPQRSTVWY';
        let sequence = '';
        for (let i = 0; i < length; i++) {
            sequence += amino_acids[Math.floor(Math.random() * amino_acids.length)];
        }
        return sequence;
    }

    /**
     * Create the main visualization with integrated sequence strip
     */
    function createVisualization() {
        if (!proteinData || !proteinData.sites.length) {
            showError('No phosphorylation sites found for this protein');
            return;
        }

        const container = document.getElementById('lollipopPlot');
        container.innerHTML = '';

        // Add the protein name to the title
        const proteinName = proteinData.protein.gene_symbol || proteinData.protein.uniprot || PROTEIN_ID;

        // Create a title element before the SVG
        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = 'text-align: center; margin-bottom: 20px;';
        titleDiv.innerHTML = `
            <h2 style="font-size: 24px; font-weight: 600; color: #F9FAFB;">
                ${proteinName} Phosphorylation Landscape
            </h2>
        `;
        container.appendChild(titleDiv);

        // Determine the viewing window based on zoom state
        const maxPosition = d3.max(proteinData.sites, d => d.position);
        const xDomainStart = viewportStart !== null ? viewportStart : 0;
        const xDomainEnd = viewportEnd !== null ? viewportEnd : maxPosition + 10;

        // Create the main SVG canvas
        svg = d3.select('#lollipopPlot')
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom + 120) // Extra height for sequence
            .attr('id', 'phosphoPlotSVG')  // Add ID for easy selection during export
            .style('display', 'block');

        // Create the plotting group where lollipops will be drawn
        plotGroup = svg.append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Set up coordinate scales
        xScale = d3.scaleLinear()
            .domain([xDomainStart, xDomainEnd])
            .range([0, width]);

        yScale = d3.scaleLinear()
            .domain([0, 1])
            .range([height, 0]);

        // Build the axes, lollipops, and sequence strip
        addAxes();
        drawLollipops();
        addSequenceStrip();
        createTooltip();
        updateZoomStatus();

        // Enable brush selection if we're in zoom mode
        if (isSelectionMode) {
            enableBrush();
        }
    }

    /**
     * Add X and Y axes with labels
     */
    function addAxes() {
        // X-axis configuration
        const xAxis = d3.axisBottom(xScale)
            .ticks(10)
            .tickFormat(d => d.toFixed(0));

        plotGroup.append('g')
            .attr('class', 'x-axis')
            .attr('transform', `translate(0,${height})`)
            .call(xAxis)
            .selectAll('text')
            .style('fill', '#9CA3AF')
            .style('font-size', '12px');

        // Style the axis lines
        plotGroup.select('.x-axis path').style('stroke', '#4B5563');
        plotGroup.selectAll('.x-axis .tick line').style('stroke', '#4B5563');

        // Y-axis configuration
        const yAxis = d3.axisLeft(yScale)
            .ticks(5)
            .tickFormat(d => d.toFixed(1));

        plotGroup.append('g')
            .attr('class', 'y-axis')
            .call(yAxis)
            .selectAll('text')
            .style('fill', '#9CA3AF')
            .style('font-size', '12px');

        plotGroup.select('.y-axis path').style('stroke', '#4B5563');
        plotGroup.selectAll('.y-axis .tick line').style('stroke', '#4B5563');

        // Axis labels
        plotGroup.append('text')
            .attr('class', 'x-label')
            .attr('text-anchor', 'middle')
            .attr('x', width / 2)
            .attr('y', height + 45)
            .style('fill', '#D1D5DB')
            .style('font-size', '14px')
            .text('Position');

        plotGroup.append('text')
            .attr('class', 'y-label')
            .attr('text-anchor', 'middle')
            .attr('transform', 'rotate(-90)')
            .attr('y', -50)
            .attr('x', -height / 2)
            .style('fill', '#D1D5DB')
            .style('font-size', '14px')
            .text('Phosphorylation Probability');
    }

    /**
     * Draw the lollipops representing phosphorylation sites
     */
    function drawLollipops() {
        const filteredSites = getFilteredSites();

        // Create a group for each lollipop
        const lollipops = plotGroup.selectAll('.lollipop')
            .data(filteredSites, d => d.site_id);

        // Remove old lollipops
        lollipops.exit().remove();

        // Enter new lollipops
        const lollipopEnter = lollipops.enter()
            .append('g')
            .attr('class', 'lollipop')
            .attr('data-site-id', d => d.site_id);

        // Add the stem (line from baseline to head)
        lollipopEnter.append('line')
            .attr('class', 'lollipop-stem')
            .attr('x1', d => xScale(d.position))
            .attr('x2', d => xScale(d.position))
            .attr('y1', height)
            .attr('y2', d => yScale(d.probability_calibrated))
            .style('stroke', d => d.fdr_05 ? '#10B981' : '#6B7280')
            .style('stroke-width', 2);

        // Add the head (circle at the top)
        lollipopEnter.append('circle')
            .attr('class', 'lollipop-head')
            .attr('cx', d => xScale(d.position))
            .attr('cy', d => yScale(d.probability_calibrated))
            .attr('r', d => d.known_positive ? 7 : 5)
            .style('fill', d => {
                if (d.known_positive) return '#EAB308';
                return d.fdr_05 ? '#10B981' : '#6B7280';
            })
            .style('stroke', d => d.known_positive ? '#CA8A04' : 'none')
            .style('stroke-width', 2)
            .style('cursor', 'pointer')
            .on('click', function(event, d) {
                event.stopPropagation();
                showSiteDetails(d);
            })
            .on('mouseover', function(event, d) {
                showTooltip(event, d);
            })
            .on('mouseout', hideTooltip);

        // Update existing lollipops
        const allLollipops = plotGroup.selectAll('.lollipop');

        allLollipops.select('.lollipop-stem')
            .transition()
            .duration(300)
            .attr('x1', d => xScale(d.position))
            .attr('x2', d => xScale(d.position))
            .attr('y2', d => yScale(d.probability_calibrated));

        allLollipops.select('.lollipop-head')
            .transition()
            .duration(300)
            .attr('cx', d => xScale(d.position))
            .attr('cy', d => yScale(d.probability_calibrated));
    }

    /**
     * Add the integrated sequence strip at the bottom
     */
    function addSequenceStrip() {
        if (!proteinSequence) return;

        // Create a foreign object to embed HTML content
        const sequenceFO = svg.append('foreignObject')
            .attr('x', margin.left)
            .attr('y', height + margin.top + 60)
            .attr('width', width)
            .attr('height', 100);

        const sequenceDiv = sequenceFO.append('xhtml:div')
            .style('width', '100%')
            .style('height', '100%')
            .style('overflow-x', 'auto')
            .style('overflow-y', 'hidden')
            .style('white-space', 'nowrap')
            .style('background', 'linear-gradient(135deg, rgba(21, 25, 35, 0.95) 0%, rgba(10, 14, 23, 0.95) 100%)')
            .style('border', '1px solid rgba(139, 92, 246, 0.3)')
            .style('border-radius', '8px')
            .style('padding', '15px');

        // Create the sequence display
        const sequenceContent = sequenceDiv.append('xhtml:div')
            .style('font-family', 'Monaco, Consolas, monospace')
            .style('font-size', '14px')
            .style('letter-spacing', '0.3em');

        // Add each amino acid as a span
        const sites = proteinData.sites;
        const sitePositions = new Set(sites.map(s => s.position));

        for (let i = 0; i < proteinSequence.length; i++) {
            const position = i + 1; // 1-indexed
            const aa = proteinSequence[i];
            const isSite = sitePositions.has(position);
            const site = sites.find(s => s.position === position);

            const aaSpan = sequenceContent.append('xhtml:span')
                .text(aa)
                .style('display', 'inline-block')
                .style('width', '20px')
                .style('height', '20px')
                .style('text-align', 'center')
                .style('line-height', '20px')
                .style('cursor', isSite ? 'pointer' : 'default')
                .style('position', 'relative')
                .attr('data-position', position);

            // Color coding for phosphorylatable residues
            if (isSite && site) {
                // Phosphorylation site - color based on confidence
                if (site.known_positive) {
                    aaSpan.style('color', '#FBB308')
                        .style('font-weight', 'bold')
                        .style('text-shadow', '0 0 10px rgba(251, 179, 8, 0.5)');
                } else if (site.fdr_05) {
                    aaSpan.style('color', '#10F981')
                        .style('font-weight', 'bold')
                        .style('text-shadow', '0 0 10px rgba(16, 249, 129, 0.3)');
                } else {
                    aaSpan.style('color', '#9CA3AF');
                }

                // Add click handler for sites
                aaSpan.on('click', function() {
                    showSiteDetails(site);
                    highlightSite(site.site_id);
                });

                // Add hover effect
                aaSpan.on('mouseover', function(event) {
                    d3.select(this)
                        .style('background', 'rgba(139, 92, 246, 0.3)')
                        .style('border-radius', '3px');
                    showTooltip(event, site);
                })
                .on('mouseout', function() {
                    d3.select(this)
                        .style('background', 'transparent');
                    hideTooltip();
                });
            } else if (['S', 'T', 'Y'].includes(aa)) {
                // Non-phosphorylated S/T/Y
                aaSpan.style('color', '#4B5563');
            } else {
                // Other amino acids
                aaSpan.style('color', '#374151');
            }

            // Add position markers every 10 residues
            if (position % 10 === 0) {
                sequenceContent.append('xhtml:span')
                    .text(' ')
                    .style('display', 'inline-block')
                    .style('width', '5px');

                sequenceContent.append('xhtml:span')
                    .text(position)
                    .style('font-size', '10px')
                    .style('color', '#6B7280')
                    .style('vertical-align', 'super');

                sequenceContent.append('xhtml:span')
                    .text(' ')
                    .style('display', 'inline-block')
                    .style('width', '5px');
            }
        }
    }

    /**
     * Highlight a specific site in the visualization
     */
    function highlightSite(siteId) {
        // Clear previous highlights
        plotGroup.selectAll('.lollipop').classed('highlighted', false);
        plotGroup.selectAll('.lollipop-head')
            .transition()
            .duration(200)
            .attr('r', d => d.known_positive ? 7 : 5)
            .style('filter', 'none');

        // Highlight the selected site
        highlightedSiteId = siteId;
        const selectedLollipop = plotGroup.selectAll('.lollipop')
            .filter(d => d.site_id === siteId);

        selectedLollipop.classed('highlighted', true);
        selectedLollipop.select('.lollipop-head')
            .transition()
            .duration(200)
            .attr('r', 10)
            .style('filter', 'drop-shadow(0 0 15px rgba(139, 92, 246, 0.8))');
    }

    /**
     * NEW: Export the plot as SVG
     */
    function exportPlotAsSVG() {
        try {
            // Clone the SVG element
            const svgNode = document.getElementById('phosphoPlotSVG');
            const clonedSvg = svgNode.cloneNode(true);

            // Add styles inline for better portability
            const styleElement = document.createElement('style');
            styleElement.textContent = `
                text { font-family: 'Inter', Arial, sans-serif; }
                .lollipop-stem { opacity: 0.8; }
                .lollipop-head { cursor: pointer; }
                .x-axis text, .y-axis text { fill: #9CA3AF; font-size: 12px; }
                .x-label, .y-label { fill: #D1D5DB; font-size: 14px; }
            `;
            clonedSvg.insertBefore(styleElement, clonedSvg.firstChild);

            // Add title and metadata
            const title = document.createElement('title');
            title.textContent = `${PROTEIN_ID} Phosphorylation Plot`;
            clonedSvg.insertBefore(title, clonedSvg.firstChild);

            // Convert to string
            const serializer = new XMLSerializer();
            const svgString = serializer.serializeToString(clonedSvg);

            // Download
            const blob = new Blob([svgString], { type: 'image/svg+xml' });
            downloadFile(blob, `${PROTEIN_ID}_phosphorylation_plot.svg`, 'image/svg+xml');

            // Show success message
            showNotification('Plot exported successfully as SVG!', 'success');
        } catch (error) {
            console.error('Failed to export SVG:', error);
            showNotification('Failed to export plot. Please try again.', 'error');
        }
    }

    /**
     * Export the plot as PNG - with automatic SVG fallback
     */
    function exportPlotAsPNG() {
        console.log('Attempting PNG export...');

        const svgNode = document.getElementById('phosphoPlotSVG');
        if (!svgNode) {
            showNotification('Plot not ready. Please wait for it to load.', 'error');
            return;
        }

        // Clone and clean the SVG
        const clonedSvg = svgNode.cloneNode(true);

        // Remove foreignObject elements (these break Canvas rendering)
        clonedSvg.querySelectorAll('foreignObject').forEach(el => el.remove());

        // Get dimensions
        const width = parseInt(svgNode.getAttribute('width')) || 1000;
        const height = parseInt(svgNode.getAttribute('height')) || 600;

        // Add background and ensure proper attributes
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('width', width);
        bg.setAttribute('height', height);
        bg.setAttribute('fill', '#0A0E17');
        clonedSvg.insertBefore(bg, clonedSvg.firstChild);

        clonedSvg.setAttribute('width', width);
        clonedSvg.setAttribute('height', height);
        clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

        // Convert to string
        const svgString = new XMLSerializer().serializeToString(clonedSvg);

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = width * 2;  // 2x resolution
        canvas.height = height * 2;
        const ctx = canvas.getContext('2d');

        // Create image
        const img = new Image();

        // Use base64 data URL (most compatible)
        const svgBase64 = btoa(unescape(encodeURIComponent(svgString)));
        const dataUrl = `data:image/svg+xml;base64,${svgBase64}`;

        img.onload = function() {
            try {
                // Scale for higher resolution
                ctx.scale(2, 2);
                ctx.fillStyle = '#0A0E17';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);

                // Try to export
                canvas.toBlob(function(blob) {
                    if (blob) {
                        // Success!
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${PROTEIN_ID}_phosphorylation_plot.png`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        showNotification('Plot exported as PNG!', 'success');
                    } else {
                        // Fallback to SVG
                        exportSVGFallback();
                    }
                }, 'image/png');
            } catch (error) {
                exportSVGFallback();
            }
        };

        img.onerror = function() {
            // Most common failure - browser security blocks SVG to Canvas
            exportSVGFallback();
        };

        img.src = dataUrl;

        // Fallback function
        function exportSVGFallback() {
            console.log('PNG blocked by browser security, downloading as SVG instead');
            const originalSvgString = new XMLSerializer().serializeToString(svgNode);
            const svgBlob = new Blob([originalSvgString], { type: 'image/svg+xml' });
            downloadFile(svgBlob, `${PROTEIN_ID}_phosphorylation_plot.svg`, 'image/svg+xml');
            showNotification('Downloaded as SVG (browser blocks PNG for security). Convert at: cloudconvert.com/svg-to-png', 'info');
        }
    }

    /**
     * NEW: Export complete kinase specificity profile
     */
    function exportKinaseProfileData() {
        if (!proteinData || !proteinData.sites.length) {
            showNotification('No data available to export', 'error');
            return;
        }

        try {
            // Prepare the data structure
            const profileData = {
                protein: {
                    uniprot: proteinData.protein.uniprot,
                    gene_symbol: proteinData.protein.gene_symbol,
                    organism: proteinData.protein.organism,
                    exported_at: new Date().toISOString()
                },
                kinase_profiles: {},
                sites: []
            };

            // Get all unique kinases
            const allKinases = new Set();
            proteinData.sites.forEach(site => {
                if (site.kinase_scores) {
                    Object.keys(site.kinase_scores).forEach(k => allKinases.add(k));
                }
            });

            // Initialize kinase profiles
            allKinases.forEach(kinase => {
                profileData.kinase_profiles[kinase] = {
                    sites: [],
                    average_score: 0,
                    max_score: 0,
                    high_confidence_sites: []
                };
            });

            // Populate data for each site
            proteinData.sites.forEach(site => {
                const siteData = {
                    position: site.position,
                    residue: site.residue,
                    site_id: site.site_id,
                    phospho_probability: site.probability_calibrated,
                    known_site: site.known_positive,
                    fdr_05: site.fdr_05,
                    fdr_02: site.fdr_02,
                    fdr_01: site.fdr_01,
                    kinase_scores: site.kinase_scores || {}
                };

                profileData.sites.push(siteData);

                // Update kinase profiles
                if (site.kinase_scores) {
                    Object.entries(site.kinase_scores).forEach(([kinase, score]) => {
                        const profile = profileData.kinase_profiles[kinase];
                        profile.sites.push({
                            position: site.position,
                            residue: site.residue,
                            score: score
                        });

                        if (score > profile.max_score) {
                            profile.max_score = score;
                        }

                        if (score >= 50) { // High confidence threshold
                            profile.high_confidence_sites.push(site.position);
                        }
                    });
                }
            });

            // Calculate average scores
            Object.keys(profileData.kinase_profiles).forEach(kinase => {
                const profile = profileData.kinase_profiles[kinase];
                if (profile.sites.length > 0) {
                    const sum = profile.sites.reduce((acc, s) => acc + s.score, 0);
                    profile.average_score = Math.round(sum / profile.sites.length * 10) / 10;
                }

                // Sort sites by score
                profile.sites.sort((a, b) => b.score - a.score);
            });

            // Convert to JSON and download
            const jsonString = JSON.stringify(profileData, null, 2);
            downloadFile(jsonString, `${PROTEIN_ID}_complete_kinase_profile.json`, 'application/json');

            // Also create a CSV version for easy analysis
            createKinaseProfileCSV(profileData);

            showNotification('Kinase profile exported successfully!', 'success');

        } catch (error) {
            console.error('Failed to export kinase profile:', error);
            showNotification('Failed to export kinase profile. Please try again.', 'error');
        }
    }

    /**
     * Create a CSV version of the kinase profile
     */
    function createKinaseProfileCSV(profileData) {
        // Create a flat CSV structure
        const headers = ['Position', 'Residue', 'Site_ID', 'Phospho_Probability', 'Known_Site',
                        'FDR_05', 'FDR_02', 'FDR_01'];

        // Add all kinase names as columns
        const kinases = Object.keys(profileData.kinase_profiles).sort();
        headers.push(...kinases);

        let csv = headers.join(',') + '\n';

        // Add data rows
        profileData.sites.forEach(site => {
            const row = [
                site.position,
                site.residue,
                site.site_id,
                site.phospho_probability.toFixed(4),
                site.known_site ? 'Yes' : 'No',
                site.fdr_05 ? 'Yes' : 'No',
                site.fdr_02 ? 'Yes' : 'No',
                site.fdr_01 ? 'Yes' : 'No'
            ];

            // Add kinase scores
            kinases.forEach(kinase => {
                const score = site.kinase_scores[kinase] || 0;
                row.push(score.toFixed(1));
            });

            csv += row.join(',') + '\n';
        });

        downloadFile(csv, `${PROTEIN_ID}_kinase_matrix.csv`, 'text/csv');
    }

    /**
     * Show a notification to the user
     */
    function showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
        `;

        // Set colors based on type
        if (type === 'success') {
            notification.style.background = 'linear-gradient(135deg, #10B981 0%, #059669 100%)';
            notification.style.color = 'white';
        } else if (type === 'error') {
            notification.style.background = 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)';
            notification.style.color = 'white';
        } else {
            notification.style.background = 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)';
            notification.style.color = 'white';
        }

        notification.textContent = message;
        document.body.appendChild(notification);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    /**
     * Utility function to download files (enhanced from original)
     */
    function downloadFile(content, filename, mimeType) {
        try {
            let blob;

            // Handle different content types
            if (content instanceof Blob) {
                blob = content;
            } else if (typeof content === 'string') {
                blob = new Blob([content], { type: mimeType });
            } else {
                console.error('Invalid content type for download:', typeof content);
                showNotification('Failed to prepare file for download', 'error');
                return;
            }

            // Create download link
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';

            // Append to body, click, and cleanup
            document.body.appendChild(link);
            link.click();

            // Cleanup after a short delay
            setTimeout(() => {
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }, 100);

            console.log(`Downloaded file: ${filename}`);
        } catch (error) {
            console.error('Download failed:', error);
            showNotification('Failed to download file. Please try again.', 'error');
        }
    }

    // Keep all the original functions from the file...
    // (The rest of the functions remain the same as in the original file)

    let isSelectionMode = false;

    function enableSelectionMode() {
        isSelectionMode = true;
        rebuildVisualization();
        document.getElementById('zoomStatus').style.display = 'block';
        document.getElementById('zoomStatus').textContent = 'Click and drag to select a region to zoom';
    }

    function resetZoom() {
        viewportStart = null;
        viewportEnd = null;
        isSelectionMode = false;
        rebuildVisualization();
        updateZoomStatus();
    }

    function updateZoomStatus() {
        const status = document.getElementById('zoomStatus');
        if (!status) return;

        if (viewportStart !== null && viewportEnd !== null) {
            status.style.display = 'block';
            status.innerHTML = `
                <span style="color: #10B981;">● Zoomed to positions ${Math.round(viewportStart)} - ${Math.round(viewportEnd)}</span>
            `;
        } else {
            status.style.display = 'none';
        }
    }

    function enableBrush() {
        const brush = d3.brushX()
            .extent([[0, 0], [width, height]])
            .on('end', function(event) {
                if (!event.selection) return;

                const [x0, x1] = event.selection;
                viewportStart = xScale.invert(x0);
                viewportEnd = xScale.invert(x1);

                // Clear the brush
                d3.select(this).call(brush.clear);

                isSelectionMode = false;
                rebuildVisualization();
            });

        plotGroup.append('g')
            .attr('class', 'brush')
            .call(brush);
    }

    function getFilteredSites() {
        let sites = [...proteinData.sites];

        // Apply FDR threshold filter
        if (currentFDRThreshold === 0.05) {
            sites = sites.filter(s => s.fdr_05);
        } else if (currentFDRThreshold === 0.02) {
            sites = sites.filter(s => s.fdr_02);
        } else if (currentFDRThreshold === 0.01) {
            sites = sites.filter(s => s.fdr_01);
        }

        // Apply residue type filter
        if (currentResidueFilter !== 'all') {
            sites = sites.filter(s => s.residue === currentResidueFilter);
        }

        // Apply known sites filter
        if (showKnownOnly) {
            sites = sites.filter(s => s.known_positive);
        }

        // Apply viewport filter if zoomed
        if (viewportStart !== null && viewportEnd !== null) {
            sites = sites.filter(s => s.position >= viewportStart && s.position <= viewportEnd);
        }

        return sites;
    }

    function updateVisualization() {
        if (!plotGroup) return;
        drawLollipops();
    }

    function rebuildVisualization() {
        createVisualization();
    }

    function createTooltip() {
        tooltip = d3.select('body').append('div')
            .attr('class', 'phospho-tooltip')
            .style('position', 'absolute')
            .style('visibility', 'hidden')
            .style('background', 'rgba(31, 41, 55, 0.95)')
            .style('border', '1px solid rgba(139, 92, 246, 0.3)')
            .style('border-radius', '8px')
            .style('padding', '12px')
            .style('font-size', '12px')
            .style('color', '#F9FAFB')
            .style('box-shadow', '0 4px 12px rgba(0, 0, 0, 0.5)')
            .style('z-index', '9999');
    }

    function showTooltip(event, d) {
        if (!tooltip) createTooltip();

        const content = `
            <div style="font-weight: 600; margin-bottom: 8px; color: #A78BFA;">
                Position ${d.position} (${d.residue})
            </div>
            <div style="margin-bottom: 4px;">
                Probability: <span style="color: #10B981;">${(d.probability_calibrated * 100).toFixed(1)}%</span>
            </div>
            <div style="margin-bottom: 4px;">
                FDR: <span style="color: ${d.fdr_01 ? '#10B981' : d.fdr_02 ? '#FBB308' : d.fdr_05 ? '#EC4899' : '#6B7280'};">
                    ${d.fdr_01 ? '< 1%' : d.fdr_02 ? '< 2%' : d.fdr_05 ? '< 5%' : '> 5%'}
                </span>
            </div>
            ${d.known_positive ? '<div style="color: #FBB308; font-weight: 600;">✓ Known Site</div>' : ''}
        `;

        tooltip.html(content)
            .style('visibility', 'visible')
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 10) + 'px');
    }

    function hideTooltip() {
        if (tooltip) {
            tooltip.style('visibility', 'hidden');
        }
    }

    function showSiteDetails(site) {
        const panel = document.getElementById('siteDetailsPanel');
        const content = document.getElementById('panelContent');

        if (!panel || !content) return;

        // Fetch the sequence motif
        fetch(`/api/protein/${PROTEIN_ID}/site/${site.position}/motif`)
            .then(response => response.json())
            .then(motifData => {
                // Get top kinases
                const kinases = site.kinase_scores ? Object.entries(site.kinase_scores) : [];
                kinases.sort((a, b) => b[1] - a[1]);
                const topKinases = kinases.slice(0, 10);

                let kinaseHTML = '';
                if (topKinases.length > 0) {
                    kinaseHTML = `
                        <div class="detail-section">
                            <h4 class="detail-subtitle">Top Kinase Predictions</h4>
                            <div class="kinase-list">
                                ${topKinases.map(([kinase, score]) => `
                                    <div class="kinase-item">
                                        <div class="kinase-header">
                                            <span class="kinase-name">${kinase}</span>
                                            <span class="kinase-score">${score.toFixed(1)}%</span>
                                        </div>
                                        <div class="kinase-bar">
                                            <div class="kinase-bar-fill" style="width: ${score}%; background: linear-gradient(90deg, #EC4899, #8B5CF6);"></div>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }

                // Display motif if available
                let motifHTML = '';
                if (motifData && motifData.motif) {
                    const motif = motifData.motif;
                    const centerIndex = motifData.center_index || 7;

                    motifHTML = `
                        <div class="detail-section">
                            <h4 class="detail-subtitle">Sequence Motif (±7 residues)</h4>
                            <div class="motif-display">
                                ${motif.split('').map((aa, idx) => {
                                    const isCenter = idx === centerIndex;
                                    return `<span class="motif-residue ${isCenter ? 'motif-center' : ''}">${aa}</span>`;
                                }).join('')}
                            </div>
                            <p class="motif-note">Central residue highlighted</p>
                        </div>
                    `;
                }

                content.innerHTML = `
                    <div class="site-details-content">
                        <div class="detail-header">
                            <h3 class="detail-title">
                                ${site.residue}${site.position}
                                ${site.known_positive ? '<span class="known-badge">Known Site</span>' : ''}
                            </h3>
                        </div>

                        ${motifHTML}

                        <div class="detail-section">
                            <h4 class="detail-subtitle">Phosphorylation Confidence</h4>
                            <div class="detail-grid">
                                <div class="detail-item">
                                    <span class="detail-label">Probability:</span>
                                    <span class="detail-value">${(site.probability_calibrated * 100).toFixed(1)}%</span>
                                </div>
                                <div class="detail-item">
                                    <span class="detail-label">Raw Score:</span>
                                    <span class="detail-value">${(site.probability_raw * 100).toFixed(1)}%</span>
                                </div>
                                <div class="detail-item">
                                    <span class="detail-label">FDR Thresholds:</span>
                                    <div class="fdr-badges">
                                        <span style="color: ${site.fdr_05 ? '#10B981' : '#6B7280'};">
                                            ${site.fdr_05 ? '✓' : '✗'} 5%
                                        </span>
                                        <span style="color: ${site.fdr_02 ? '#10B981' : '#6B7280'};">
                                            ${site.fdr_02 ? '✓' : '✗'} 2%
                                        </span>
                                        <span style="color: ${site.fdr_01 ? '#10B981' : '#6B7280'};">
                                            ${site.fdr_01 ? '✓' : '✗'} 1%
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        ${kinaseHTML}
                    </div>
                `;

                panel.classList.add('active');
            })
            .catch(error => {
                console.error('Failed to fetch motif:', error);
                // Show panel without motif if fetch fails
                showSiteDetailsWithoutMotif(site);
            });
    }

    function showSiteDetailsWithoutMotif(site) {
        const panel = document.getElementById('siteDetailsPanel');
        const content = document.getElementById('panelContent');

        if (!panel || !content) return;

        // Get top kinases
        const kinases = site.kinase_scores ? Object.entries(site.kinase_scores) : [];
        kinases.sort((a, b) => b[1] - a[1]);
        const topKinases = kinases.slice(0, 10);

        let kinaseHTML = '';
        if (topKinases.length > 0) {
            kinaseHTML = `
                <div class="detail-section">
                    <h4 class="detail-subtitle">Top Kinase Predictions</h4>
                    <div class="kinase-list">
                        ${topKinases.map(([kinase, score]) => `
                            <div class="kinase-item">
                                <div class="kinase-header">
                                    <span class="kinase-name">${kinase}</span>
                                    <span class="kinase-score">${score.toFixed(1)}%</span>
                                </div>
                                <div class="kinase-bar">
                                    <div class="kinase-bar-fill" style="width: ${score}%; background: linear-gradient(90deg, #EC4899, #8B5CF6);"></div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        content.innerHTML = `
            <div class="site-details-content">
                <div class="detail-header">
                    <h3 class="detail-title">
                        ${site.residue}${site.position}
                        ${site.known_positive ? '<span class="known-badge">Known Site</span>' : ''}
                    </h3>
                </div>

                <div class="detail-section">
                    <h4 class="detail-subtitle">Phosphorylation Confidence</h4>
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span class="detail-label">Probability:</span>
                            <span class="detail-value">${(site.probability_calibrated * 100).toFixed(1)}%</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Raw Score:</span>
                            <span class="detail-value">${(site.probability_raw * 100).toFixed(1)}%</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">FDR Thresholds:</span>
                            <div class="fdr-badges">
                                <span style="color: ${site.fdr_05 ? '#10B981' : '#6B7280'};">
                                    ${site.fdr_05 ? '✓' : '✗'} 5%
                                </span>
                                <span style="color: ${site.fdr_02 ? '#10B981' : '#6B7280'};">
                                    ${site.fdr_02 ? '✓' : '✗'} 2%
                                </span>
                                <span style="color: ${site.fdr_01 ? '#10B981' : '#6B7280'};">
                                    ${site.fdr_01 ? '✓' : '✗'} 1%
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                
                ${kinaseHTML}
            </div>
        `;

        panel.classList.add('active');
    }

    function hideSiteDetailsPanel() {
        const panel = document.getElementById('siteDetailsPanel');
        if (panel) {
            panel.classList.remove('active');
        }
        // Clear highlight when closing panel
        highlightedSiteId = null;
        plotGroup.selectAll('.lollipop').classed('highlighted', false);
        plotGroup.selectAll('.lollipop-head')
            .transition()
            .duration(200)
            .attr('r', d => d.known_positive ? 7 : 5)
            .style('filter', 'none');
    }

    function populateKinaseDropdown() {
        const select = document.getElementById('kinaseSelect');
        if (!select || !proteinData || !proteinData.sites.length) return;
        const siteWithKinases = proteinData.sites.find(s => s.kinase_scores);
        if (!siteWithKinases) return;
        const kinases = Object.keys(siteWithKinases.kinase_scores).sort();
        kinases.forEach(kinase => {
            const option = document.createElement('option');
            option.value = kinase;
            option.textContent = kinase;
            select.appendChild(option);
        });
        select.addEventListener('change', function() {
            if (this.value) showKinaseProfile(this.value);
        });
    }

    function showKinaseProfile(kinaseName) {
        const container = document.getElementById('kinaseProfile');
        if (!container) return;
        const profileData = proteinData.sites
            .filter(site => site.kinase_scores && site.kinase_scores[kinaseName] !== undefined)
            .map(site => ({
                position: site.position,
                score: site.kinase_scores[kinaseName],
                residue: site.residue
            }));
        container.innerHTML = `
            <h3 style="margin-bottom: 16px; color: #D1D5DB;">${kinaseName} Specificity Profile</h3>
            <div id="kinaseProfileChart" style="min-height: 200px;"></div>
        `;
        const chartDiv = document.getElementById('kinaseProfileChart');
        let html = '<div style="max-height: 400px; overflow-y: auto;">';
        profileData.forEach(d => {
            html += `
                <div style="margin-bottom: 8px; padding: 8px; background-color: #2D3748; border-radius: 4px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                        <span>Position ${d.position} (${d.residue})</span>
                        <span style="color: #9CA3AF;">${d.score.toFixed(1)}%</span>
                    </div>
                    <div style="background-color: #1A202C; height: 6px; border-radius: 3px; overflow: hidden;">
                        <div style="background: linear-gradient(90deg, #EC4899, #8B5CF6); height: 100%; width: ${d.score}%;"></div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        chartDiv.innerHTML = html;
    }

    function handleResize() {
        calculateDimensions();
        rebuildVisualization();
    }

    function exportAsCSV() {
        console.log('exportAsCSV called');
        if (!proteinData || !proteinData.sites) {
            console.error('No protein data available');
            showNotification('No data available to export', 'error');
            return;
        }

        try {
            const headers = ['Position', 'Residue', 'Probability', 'Known_Site', 'FDR_05', 'FDR_02', 'FDR_01'];
            let csv = headers.join(',') + '\n';

            proteinData.sites.forEach(site => {
                csv += [
                    site.position,
                    site.residue,
                    site.probability_calibrated.toFixed(4),
                    site.known_positive ? 'Yes' : 'No',
                    site.fdr_05 ? 'Yes' : 'No',
                    site.fdr_02 ? 'Yes' : 'No',
                    site.fdr_01 ? 'Yes' : 'No'
                ].join(',') + '\n';
            });

            downloadFile(csv, `${PROTEIN_ID}_phosphorylation.csv`, 'text/csv');
            showNotification('Data exported successfully as CSV!', 'success');
        } catch (error) {
            console.error('Failed to export CSV:', error);
            showNotification('Failed to export CSV. Please try again.', 'error');
        }
    }

    function exportAsJSON() {
        console.log('exportAsJSON called');
        if (!proteinData) {
            console.error('No protein data available');
            showNotification('No data available to export', 'error');
            return;
        }

        try {
            const json = JSON.stringify(proteinData, null, 2);
            downloadFile(json, `${PROTEIN_ID}_phosphorylation.json`, 'application/json');
            showNotification('Data exported successfully as JSON!', 'success');
        } catch (error) {
            console.error('Failed to export JSON:', error);
            showNotification('Failed to export JSON. Please try again.', 'error');
        }
    }

    function showError(message) {
        const container = document.getElementById('lollipopPlot');
        if (container) {
            container.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; min-height: 400px; color: #EF4444;">
                    <div style="text-align: center;">
                        <svg style="width: 48px; height: 48px; margin: 0 auto 16px;" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                            <path d="M12 8V12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            <circle cx="12" cy="16" r="1" fill="currentColor"/>
                        </svg>
                        <div style="font-size: 18px; font-weight: 600;">${message}</div>
                    </div>
                </div>
            `;
        }
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Add CSS for notifications
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        .motif-display {
            font-family: Monaco, Consolas, monospace;
            font-size: 16px;
            letter-spacing: 0.2em;
            margin: 12px 0;
            padding: 12px;
            background: rgba(10, 14, 23, 0.6);
            border-radius: 8px;
            text-align: center;
        }
        .motif-residue {
            display: inline-block;
            width: 24px;
            text-align: center;
            color: #9CA3AF;
        }
        .motif-center {
            color: #FBB308;
            font-weight: bold;
            background: rgba(251, 179, 8, 0.2);
            border-radius: 4px;
        }
        .motif-note {
            font-size: 12px;
            color: #6B7280;
            text-align: center;
            margin-top: 8px;
        }
    `;
    document.head.appendChild(style);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();