const PDFDocument = require('pdfkit');
const { getLanguageConfig } = require('../utils/language');

function generateMinimalTemplate(data, doc, language = 'en') {
  const languageConfig = getLanguageConfig(language);
  
  // ATS-friendly: Use only black text for maximum compatibility
  const textColor = '#000000';
  
  // Header
  doc.font('Helvetica-Bold')
     .fontSize(24)
     .fillColor(textColor)
     .text(data.fullName, { align: 'center' });
  
  if (data.headline) {
    doc.moveDown(0.2);
    doc.font('Helvetica')
       .fontSize(13)
       .fillColor(textColor)
       .text(data.headline, { align: 'center' });
  }

  // Contact information
  doc.moveDown(0.2);
  doc.font('Helvetica')
     .fontSize(10) // Reduced from 12 to match "compact" request
     .fillColor(textColor);
  
  const contactInfo = [
    data.email,
    data.phone,
    data.address,
    data.linkedIn,
    data.website
  ].filter(Boolean).join(' | ');
  
  doc.text(contactInfo, { align: 'center' });
  doc.moveDown(0.5);

  // Add separator after Header
  doc.strokeColor(textColor)
     .lineWidth(1)
     .moveTo(36, doc.y) // Adjusted for new margins (36)
     .lineTo(576, doc.y) // Adjusted for new margins (612 - 36 = 576)
     .stroke();
  doc.moveDown(0.5); // Reduced from 1
  
  // Summary
  if (data.summary) {
    doc.font('Helvetica')
       .fontSize(10) // Reduced to 10 for better density
       .fillColor(textColor)
       .text(data.summary, {
         align: 'justify',
         lineGap: 1.5 // Tighter line height
       });
    doc.moveDown(0.5); // Reduced from 1
  }

  // Skills
  if (data.skills.length > 0) {
    // Add separator before Skills section
    doc.strokeColor(textColor)
       .lineWidth(0.5)
       .moveTo(36, doc.y)
       .lineTo(576, doc.y)
       .stroke();
    doc.moveDown(0.5);
    
    doc.font('Helvetica-Bold') // Bold label
       .fontSize(10)
       .fillColor(textColor)
       .text(languageConfig.sections.skills + ': ', { continued: true });

    doc.font('Helvetica')
       .text(data.skills.map(skill => skill.name).join(', '), {
         lineGap: 1.5
       });
    doc.moveDown(0.5);
  }

  // Languages
  if (data.languages.length > 0) {
    doc.moveDown(0.5);
    // Add separator before Languages section
    doc.strokeColor(textColor)
       .lineWidth(0.5)
       .moveTo(36, doc.y)
       .lineTo(576, doc.y)
       .stroke();
    doc.moveDown(0.5);
    
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor(textColor)
       .text(languageConfig.sections.languages);
    doc.moveDown(0.2);
    
    doc.font('Helvetica')
       .fontSize(10)
       .fillColor(textColor);
    
    const { localizeLanguageName, localizeProficiency } = require('../utils/language');
    data.languages.forEach(lang => {
      const localizedName = localizeLanguageName(lang.name, language);
      const localizedProf = localizeProficiency(lang.proficiency, language);
      doc.text(`${localizedName} - ${localizedProf}`, {
        lineGap: 1.5
      });
    });
  }

  // Work Experience
  // Add separator before Experience section
  doc.strokeColor(textColor)
     .lineWidth(0.5)
     .moveTo(36, doc.y)
     .lineTo(576, doc.y)
     .stroke();
  doc.moveDown(0.5);
  
  doc.font('Helvetica-Bold')
     .fontSize(10)
     .fillColor(textColor)
     .text(languageConfig.sections.professionalExperience);
  doc.moveDown(0.2);
  doc.font('Helvetica');
  
  data.workExperience.forEach((exp, index) => {
    if (index > 0) {
      doc.moveDown(0.5);
    }

    // Job Title (Left) and Dates (Right)
    const startY = doc.y;
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor(textColor)
       .text(exp.jobTitle, { continued: false });
    
    const dateAndLocation = [
      `${exp.startDate} - ${exp.endDate || 'Present'}`,
      exp.location
    ].filter(Boolean).join(' | ');

    // Print Date aligned right on the same line level
    doc.y = startY;
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .text(dateAndLocation, { align: 'right' });
    
    // Company (Left)
    const companyLine = [
      exp.company,
      exp.companyDescription
    ].filter(Boolean).join(' | ');

    doc.font('Helvetica-Bold')
       .fontSize(9)
       .fillColor(textColor)
       .text(companyLine);
    
    doc.moveDown(0.2);
    
    if (exp.description) {
      doc.font('Helvetica')
         .fontSize(10)
         .fillColor(textColor)
          .text((() => {
            const cd = (exp.companyDescription || '').toString().trim();
            if (!cd) return exp.description;
            try {
              const re = new RegExp(cd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
              return exp.description.replace(re, '').trim();
            } catch (_) {
              return exp.description;
            }
          })(), {
           align: 'justify',
           lineGap: 1.5
         });
    }

    if (exp.techStack) {
      doc.moveDown(0.2);
      const { getLanguageConfig } = require('../utils/language');
      const techLabel = (getLanguageConfig(language).labels && getLanguageConfig(language).labels.tech) || 'Tech';
      doc.font('Helvetica')
         .fontSize(9)
         .fillColor(textColor)
         .text(`${techLabel}: ${exp.techStack}`);
    }
  });

  doc.moveDown(0.5);

  // Education
  // Add separator before Education section
  doc.strokeColor(textColor)
     .lineWidth(0.5)
     .moveTo(36, doc.y)
     .lineTo(576, doc.y)
     .stroke();
  doc.moveDown(0.5);
  
  doc.font('Helvetica-Bold')
     .fontSize(10)
     .fillColor(textColor)
     .text(languageConfig.sections.education);
  doc.moveDown(0.2);
  doc.font('Helvetica');
  
  data.education.forEach((edu, index) => {
    if (index > 0) {
      doc.moveDown(0.5);
    }

    const startY = doc.y;
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor(textColor)
       .text(edu.degree);
    
    const dateLine = `${edu.startYear ? edu.startYear + (edu.graduationYear ? ' - ' : '') : ''}${edu.graduationYear || ''}`;
    doc.y = startY;
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .text(dateLine, { align: 'right' });
    
    doc.font('Helvetica')
       .fontSize(10)
       .fillColor(textColor)
       .text(edu.institution);
       
    if (edu.description) {
      doc.moveDown(0.2);
      doc.font('Helvetica')
         .fontSize(10)
         .fillColor(textColor)
         .text(edu.description, {
           align: 'justify',
           lineGap: 1.5
         });
    }
  });

  // Certifications
  if (data.certifications && data.certifications.length > 0) {
    doc.moveDown(0.5);
    // Add separator before Certifications section
    doc.strokeColor(textColor)
       .lineWidth(0.5)
       .moveTo(36, doc.y)
       .lineTo(576, doc.y)
       .stroke();
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor(textColor)
       .text(languageConfig.sections.certifications);
    doc.moveDown(0.2);
    
    data.certifications.forEach((cert, index) => {
      if (index > 0) {
        doc.moveDown(0.5);
      }

      const startY = doc.y;
      doc.font('Helvetica-Bold')
         .fontSize(10)
         .fillColor(textColor)
         .text(cert.name);
      
      const issueYear = (() => {
        if (!cert.issueDate) return null;
        try {
          const d = new Date(cert.issueDate);
          return isNaN(d.getTime()) ? String(cert.issueDate) : d.getUTCFullYear().toString();
        } catch (_) {
          return String(cert.issueDate);
        }
      })();

      if (issueYear) {
        doc.y = startY;
        doc.font('Helvetica-Bold')
           .fontSize(10)
           .text(issueYear, { align: 'right' });
      }

      doc.font('Helvetica')
         .fontSize(10)
         .fillColor(textColor)
         .text(cert.issuer);
    });
  }
}

module.exports = generateMinimalTemplate;
