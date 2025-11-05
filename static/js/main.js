/**
 * KinoPlex Main JavaScript
 * Common functionality shared across all pages
 */

(function() {
    'use strict';

    /**
     * Initialize common functionality
     */
    function init() {
        // Add smooth scrolling for anchor links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            });
        });

        // Add active state to navigation links
        highlightActiveNavLink();
    }

    /**
     * Highlight the active navigation link based on current page
     */
    function highlightActiveNavLink() {
        const currentPath = window.location.pathname;
        const navLinks = document.querySelectorAll('.nav-link');

        navLinks.forEach(link => {
            const linkPath = new URL(link.href).pathname;
            if (linkPath === currentPath || (currentPath.includes('/protein/') && linkPath === '/')) {
                link.style.backgroundColor = 'var(--color-bg-tertiary)';
                link.style.color = 'var(--color-text-primary)';
            }
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();