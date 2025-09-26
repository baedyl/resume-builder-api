const PDFDocument = require('pdfkit');
const { getLanguageConfig } = require('../utils/language');

function generateMinimalTemplate(data, doc, language = 'en') {
  const languageConfig = getLanguageConfig(language);
  
  // ATS-friendly: Use only black text for maximum compatibility
  const textColor = '#000000';
  
  // Header
  doc.font('Helvetica-Bold')
     .fontSize(20)
     .fillColor(textColor)
     .text(data.fullName, { align: 'left' });
  
  // Contact information
  doc.font('Helvetica')
     .fontSize(11)
     .fillColor(textColor);
  
  const contactInfo = [
    data.email,
    data.phone,
    data.address,
    data.linkedIn,
    data.website
  ].filter(Boolean).join(' | ');
  
  doc.text(contactInfo);
  doc.moveDown(1);
  
  // Summary
  if (data.summary) {
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor(textColor)
       .text(data.summary, {
         align: 'justify',
         lineGap: 2
       });
    doc.moveDown(1);
  }

  // Skills
  if (data.skills.length > 0) {
    // Add separator before Skills section
    doc.strokeColor(textColor)
       .lineWidth(0.5)
       .moveTo(50, doc.y)
       .lineTo(545, doc.y)
       .stroke();
    doc.moveDown(1);
    
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor(textColor)
       .text(languageConfig.sections.skills + ': ' + data.skills.map(skill => skill.name).join(', '), {
         lineGap: 2
       });
    doc.moveDown(1);
  }

  // Languages
  if (data.languages.length > 0) {
    doc.moveDown(1);
    // Add separator before Languages section
    doc.strokeColor(textColor)
       .lineWidth(0.5)
       .moveTo(50, doc.y)
       .lineTo(545, doc.y)
       .stroke();
    doc.moveDown(1);
    
    doc.font('Helvetica-Bold')
       .fontSize(11)
       .fillColor(textColor)
       .text(languageConfig.sections.languages);
    doc.moveDown(0.5);
    
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor(textColor);
    
    data.languages.forEach(lang => {
      doc.text(`${lang.name} - ${lang.proficiency}`, {
        lineGap: 2
      });
    });
  }

  // Work Experience
  // Add separator before Experience section
  doc.strokeColor(textColor)
     .lineWidth(0.5)
     .moveTo(50, doc.y)
     .lineTo(545, doc.y)
     .stroke();
  doc.moveDown(1);
  
  doc.font('Helvetica-Bold')
     .fontSize(11)
     .fillColor(textColor)
     .text(languageConfig.sections.professionalExperience);
  doc.moveDown(0.5);
  doc.font('Helvetica');
  
  data.workExperience.forEach((exp, index) => {
    if (index > 0) {
      doc.moveDown(1);
    }

    doc.font('Helvetica-Bold')
       .fontSize(11)
       .fillColor(textColor)
       .text(exp.jobTitle);
    
    const companyLine = [
      exp.company,
      exp.companyDescription
    ].filter(Boolean).join(' | ');

    doc.font('Helvetica')
       .fontSize(11)
        .fillColor(textColor)
        .text(companyLine);
    
    const dateAndLocation = [
      `${exp.startDate} - ${exp.endDate || 'Present'}`,
      exp.location
    ].filter(Boolean).join(' | ');
    
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor(textColor)
       .text(dateAndLocation);
    
    doc.moveDown(0.5);
    
    if (exp.description) {
      doc.font('Helvetica')
         .fontSize(11)
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
           lineGap: 2
         });
    }

    if (exp.techStack) {
      const { getLanguageConfig } = require('../utils/language');
      const techLabel = (getLanguageConfig(language).labels && getLanguageConfig(language).labels.tech) || 'Tech';
      doc.font('Helvetica')
         .fontSize(10)
         .fillColor(textColor)
         .text(`${techLabel}: ${exp.techStack}`);
    }
  });

  doc.moveDown(1);

  // Education
  // Add separator before Education section
  doc.strokeColor(textColor)
     .lineWidth(0.5)
     .moveTo(50, doc.y)
     .lineTo(545, doc.y)
     .stroke();
  doc.moveDown(1);
  
  doc.font('Helvetica-Bold')
     .fontSize(11)
     .fillColor(textColor)
     .text(languageConfig.sections.education);
  doc.moveDown(0.5);
  doc.font('Helvetica');
  
  data.education.forEach((edu, index) => {
    if (index > 0) {
      doc.moveDown(1);
    }

    doc.font('Helvetica-Bold')
       .fontSize(11)
       .fillColor(textColor)
       .text(edu.degree);
    
    const educationDetails = [
      edu.institution,
      edu.major,
      edu.graduationYear,
      edu.gpa ? `GPA: ${edu.gpa}` : null
    ].filter(Boolean).join(' | ');
    
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor(textColor)
       .text(educationDetails);
    
    if (edu.description) {
      doc.moveDown(0.5);
      doc.font('Helvetica')
         .fontSize(11)
         .fillColor(textColor)
         .text(edu.description, {
           align: 'justify',
           lineGap: 2
         });
    }
  });

  // Certifications
  if (data.certifications.length > 0) {
    doc.moveDown(1);
    doc.font('Helvetica-Bold')
       .fontSize(11)
       .fillColor(textColor)
       .text(languageConfig.sections.certifications);
    doc.moveDown(0.5);
    
    data.certifications.forEach((cert, index) => {
      if (index > 0) {
        doc.moveDown(1);
      }

      doc.font('Helvetica-Bold')
         .fontSize(11)
         .fillColor(textColor)
         .text(cert.name);
      
      const certDetails = [
        cert.issuer,
        cert.issueDate
      ].filter(Boolean).join(' | ');
      
      doc.font('Helvetica')
         .fontSize(11)
         .fillColor(textColor)
         .text(certDetails);
    });
  }
}

module.exports = generateMinimalTemplate; 