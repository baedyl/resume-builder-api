"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDate = parseDate;
function parseDate(dateString) {
    if (!dateString)
        return null;
    try {
        const date = new Date(dateString);
        // Check if the date is valid
        if (isNaN(date.getTime())) {
            return null;
        }
        return date;
    }
    catch (error) {
        console.warn('Invalid date string:', dateString);
        return null;
    }
}
