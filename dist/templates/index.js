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
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: {
      top: 50,
      bottom: 50,
      left: 50,
      right: 50
    }
  });

  // Get the template generator function
  const templateGenerator = templates[template] || templates.modern;
  
  // Generate the resume using the selected template and language
  templateGenerator(data, doc, language);
  
  return doc;
}

module.exports = generateResume; 