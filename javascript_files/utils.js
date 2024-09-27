/*
    * utils.js
    * Utility functions used in the application.
*/

function sanitizeFilename(filename) {
    return filename.replace(/[\\/*?:"<>|]/g, "_").trim();
}

module.exports = { sanitizeFilename };
