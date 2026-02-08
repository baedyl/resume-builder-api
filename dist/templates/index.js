const generateModernTemplate = require('./modern');
const generateClassicTemplate = require('./classic');
const generateMinimalTemplate = require('./minimal');
const generateColorfulTemplate = require('./colorful');

const templates = {
  modern: generateModernTemplate,
  classic: generateClassicTemplate,
  minimal: generateMinimalTemplate,
  colorful: generateColorfulTemplate
};

function generateResume(data, template = 'modern', language = 'en') {
  const PDFDocument = require('pdfkit');
  // NOTE:
  // Preview uses the HTML renderer (A4). The PDFKit renderer historically used LETTER,
  // which is shorter and can cause content to spill onto a second page.
  // Keep defaults for existing templates, but tighten + switch to A4 for minimal.
  const pdfOptionsByTemplate = {
    minimal: {
      size: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    }
  };

  const opts = pdfOptionsByTemplate[template] || {
    size: 'LETTER',
    margins: { top: 50, bottom: 50, left: 50, right: 50 }
  };

  const doc = new PDFDocument(opts);

  // Get the template generator function
  const templateGenerator = templates[template] || templates.modern;
  
  // Generate the resume using the selected template and language
  templateGenerator(data, doc, language);
  
  return doc;
}

module.exports = generateResume; 
