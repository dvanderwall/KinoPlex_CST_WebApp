/**
 * KinoPlex Search Module
 * Handles protein search, autocomplete, and navigation to results
 *
 * This module demonstrates a pattern you'll see throughout modern web apps:
 * debounced autocomplete. As users type, we don't want to hammer the server
 * with requests on every keystroke - instead, we wait for a brief pause in
 * typing before making the API call. This reduces server load and makes the
 * experience feel more responsive.
 */

(function() {
    'use strict';

    // DOM element references - cache these on page load for efficiency
    const searchInput = document.getElementById('proteinSearch');
    const searchButton = document.getElementById('searchButton');
    const autocompleteResults = document.getElementById('autocompleteResults');
    const searchMessage = document.getElementById('searchMessage');

    // State management
    let currentQuery = '';
    let debounceTimer = null;
    let selectedIndex = -1;
    let searchResults = [];

    /**
     * Initialize the search interface
     * Sets up all event listeners and loads initial statistics
     */
    function init() {
        if (!searchInput || !searchButton) {
            console.error('Search elements not found');
            return;
        }

        // Set up event listeners
        searchInput.addEventListener('input', handleInput);
        searchInput.addEventListener('keydown', handleKeyboard);
        searchButton.addEventListener('click', performSearch);

        // Close autocomplete when clicking outside
        document.addEventListener('click', function(e) {
            if (!autocompleteResults.contains(e.target) && e.target !== searchInput) {
                hideAutocomplete();
            }
        });

        // Handle example protein links
        const exampleLinks = document.querySelectorAll('.example-link');
        exampleLinks.forEach(link => {
            link.addEventListener('click', function() {
                const proteinId = this.getAttribute('data-protein');
                navigateToProtein(proteinId);
            });
        });

        // Load database statistics if on home page
        loadStatistics();
    }

    /**
     * Handle input events on the search box
     * Uses debouncing to avoid excessive API calls
     *
     * Debouncing explained: Imagine typing "DHX8". Without debouncing,
     * we'd make API calls for "D", "DH", "DHX", and "DHX8" - four calls!
     * With debouncing, we wait 300ms after the user stops typing before
     * making a single call. This dramatically reduces server load.
     */
    function handleInput(e) {
        const query = e.target.value.trim();
        currentQuery = query;

        // Clear any pending debounce timer
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        // If query is too short, hide autocomplete
        if (query.length < 2) {
            hideAutocomplete();
            searchMessage.textContent = '';
            return;
        }

        // Set a new debounce timer
        // This creates a 300ms window after the last keystroke
        debounceTimer = setTimeout(function() {
            fetchAutocomplete(query);
        }, 300);
    }

    /**
     * Fetch autocomplete suggestions from the API
     * This demonstrates a clean async/await pattern for API calls
     */
    async function fetchAutocomplete(query) {
        try {
            searchMessage.textContent = 'Searching...';

            // Make the API request
            // The query parameter is URL-encoded automatically by URLSearchParams
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);

            if (!response.ok) {
                throw new Error('Search request failed');
            }

            const results = await response.json();
            searchResults = results;

            // Display the results
            if (results.length === 0) {
                showNoResults();
            } else {
                showAutocomplete(results);
                searchMessage.textContent = `Found ${results.length} matches`;
            }

        } catch (error) {
            console.error('Autocomplete error:', error);
            searchMessage.textContent = 'Search error. Please try again.';
            hideAutocomplete();
        }
    }

    /**
     * Display autocomplete results
     * Creates HTML for each result and makes them clickable
     */
    function showAutocomplete(results) {
        // Clear previous results
        autocompleteResults.innerHTML = '';
        selectedIndex = -1;

        // Create a clickable item for each result
        results.forEach((result, index) => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.setAttribute('data-index', index);

            // Display gene symbol prominently, with UniProt ID as secondary info
            item.innerHTML = `
                <span class="autocomplete-protein">${result.gene_symbol || result.uniprot}</span>
                ${result.gene_symbol !== 'N/A' ? `<span class="autocomplete-id">${result.uniprot}</span>` : ''}
            `;

            // Click handler
            item.addEventListener('click', function() {
                selectResult(result);
            });

            // Hover handler for keyboard navigation
            item.addEventListener('mouseenter', function() {
                selectedIndex = index;
                updateSelection();
            });

            autocompleteResults.appendChild(item);
        });

        // Show the dropdown
        autocompleteResults.classList.add('active');
    }

    /**
     * Hide autocomplete dropdown
     */
    function hideAutocomplete() {
        autocompleteResults.classList.remove('active');
        selectedIndex = -1;
    }

    /**
     * Show message when no results found
     */
    function showNoResults() {
        autocompleteResults.innerHTML = `
            <div class="autocomplete-item" style="cursor: default;">
                <span class="autocomplete-protein">No proteins found</span>
            </div>
        `;
        autocompleteResults.classList.add('active');
        searchMessage.textContent = 'No matches found. Try a different search term.';
    }

    /**
     * Handle keyboard navigation in autocomplete
     * Arrow keys to navigate, Enter to select, Escape to close
     */
    function handleKeyboard(e) {
        // Only handle keyboard if autocomplete is visible
        if (!autocompleteResults.classList.contains('active')) {
            if (e.key === 'Enter') {
                performSearch();
            }
            return;
        }

        switch(e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, searchResults.length - 1);
                updateSelection();
                break;

            case 'ArrowUp':
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, -1);
                updateSelection();
                break;

            case 'Enter':
                e.preventDefault();
                if (selectedIndex >= 0 && selectedIndex < searchResults.length) {
                    selectResult(searchResults[selectedIndex]);
                } else {
                    performSearch();
                }
                break;

            case 'Escape':
                hideAutocomplete();
                break;
        }
    }

    /**
     * Update visual selection in autocomplete list
     * Highlights the currently selected item
     */
    function updateSelection() {
        const items = autocompleteResults.querySelectorAll('.autocomplete-item');
        items.forEach((item, index) => {
            if (index === selectedIndex) {
                item.style.backgroundColor = 'var(--color-bg-hover)';
            } else {
                item.style.backgroundColor = '';
            }
        });
    }

    /**
     * Handle selection of an autocomplete result
     */
    function selectResult(result) {
        hideAutocomplete();
        navigateToProtein(result.uniprot);
    }

    /**
     * Perform search when button is clicked or Enter is pressed
     * If there's text in the box, use the first autocomplete result
     * or attempt a direct match
     */
    function performSearch() {
        const query = searchInput.value.trim();

        if (!query) {
            searchMessage.textContent = 'Please enter a protein identifier';
            return;
        }

        // If we have autocomplete results, use the first one
        if (searchResults.length > 0) {
            navigateToProtein(searchResults[0].uniprot);
        } else {
            // Try direct navigation with the query
            // This handles cases where user types exact ID and hits Enter immediately
            navigateToProtein(query);
        }
    }

    /**
     * Navigate to the protein visualization page
     * This is the final step in the search flow - taking the user to their results
     */
    function navigateToProtein(identifier) {
        // Show loading state
        searchMessage.textContent = 'Loading protein data...';
        searchButton.disabled = true;

        // Navigate to the protein page
        // The Flask backend will handle the identifier and render the page
        window.location.href = `/protein/${encodeURIComponent(identifier)}`;
    }

    /**
     * Load and display database statistics
     * This populates the statistics section on the home page
     * to build credibility and show the scope of the database
     */
    async function loadStatistics() {
        const statElements = {
            proteins: document.querySelector('[data-stat="proteins"]'),
            sites: document.querySelector('[data-stat="sites"]'),
            kinases: document.querySelector('[data-stat="kinases"]')
        };

        // Only load if we're on a page with these elements
        if (!statElements.proteins) return;

        try {
            const response = await fetch('/api/stats');
            if (!response.ok) return;

            const stats = await response.json();

            // Format numbers with commas for readability
            if (statElements.proteins && stats.unique_proteins) {
                animateNumber(statElements.proteins, stats.unique_proteins);
            }

            if (statElements.sites && stats.total_phospho_sites) {
                animateNumber(statElements.sites, stats.total_phospho_sites);
            }

            if (statElements.kinases) {
                // Count total unique kinases from both S/T and Y
                const stKinases = stats.st_kinases ? stats.st_kinases.length : 0;
                const yKinases = stats.y_kinases ? stats.y_kinases.length : 0;
                // Use the larger of the two (they may overlap)
                const totalKinases = Math.max(stKinases, yKinases);
                animateNumber(statElements.kinases, totalKinases);
            }

        } catch (error) {
            console.error('Failed to load statistics:', error);
        }
    }

    /**
     * Animate counting up to a number
     * This creates a satisfying visual effect that draws attention to the stats
     *
     * The animation uses requestAnimationFrame for smooth, efficient animation
     * that's synchronized with the browser's repaint cycle
     */
    function animateNumber(element, target) {
        const duration = 2000; // 2 seconds
        const start = 0;
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Ease out cubic function for smooth deceleration
            const easeProgress = 1 - Math.pow(1 - progress, 3);

            const current = Math.floor(start + (target - start) * easeProgress);
            element.textContent = formatNumber(current);

            if (progress < 1) {
                requestAnimationFrame(update);
            } else {
                element.textContent = formatNumber(target);
            }
        }

        requestAnimationFrame(update);
    }

    /**
     * Format numbers with commas (e.g., 1234567 -> 1,234,567)
     */
    function formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();