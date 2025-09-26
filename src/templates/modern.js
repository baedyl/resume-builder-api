const PDFDocument = require('pdfkit');
const { getLanguageConfig } = require('../utils/language');

function generateModernTemplate(data, doc, language = 'en') {
  const languageConfig = getLanguageConfig(language);
  
  // ATS-friendly: Use only black text for maximum compatibility
  const textColor = '#000000';
  
  // Header
  doc.font('Helvetica-Bold')
     .fontSize(24)
     .fillColor(textColor)
     .text(data.fullName, { align: 'center' });
  
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
  ].filter(Boolean).join(' • ');
  
  doc.text(contactInfo, { align: 'center' });
  doc.moveDown(1);

  // ATS-friendly: Use simple line separator
  doc.strokeColor(textColor)
     .lineWidth(0.5)
     .moveTo(50, doc.y)
     .lineTo(545, doc.y)
     .stroke();
  doc.moveDown(1);

  // Summary
  if (data.summary) {
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .fillColor(textColor)
       .text(languageConfig.sections.professionalSummary);
    
    doc.moveDown(0.5);
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
    
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .fillColor(textColor)
       .text(languageConfig.sections.skills);
    
    doc.moveDown(0.5);
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor(textColor);
    
    const skillsText = data.skills.map(skill => skill.name).join(' • ');
    doc.text(skillsText, {
      align: 'center',
      lineGap: 2
    });
    doc.moveDown(1);
  }

  // Work Experience
  // Add separator before Professional Experience section
  doc.strokeColor(textColor)
     .lineWidth(0.5)
     .moveTo(50, doc.y)
     .lineTo(545, doc.y)
     .stroke();
  doc.moveDown(1);
  
  doc.font('Helvetica-Bold')
     .fontSize(12)
     .fillColor(textColor)
     .text(languageConfig.sections.professionalExperience);
  doc.moveDown(0.5);

  data.workExperience.forEach((exp, index) => {
    if (index > 0) {
      doc.moveDown(1);
    }

    doc.font('Helvetica-Bold')
       .fontSize(11)
       .fillColor(textColor)
       .text(exp.jobTitle);
    
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor(textColor)
       .text(exp.company);
    
    const companyLine = [
      exp.company,
      exp.companyDescription
    ].filter(Boolean).join(' | ');

    doc.font('Helvetica')
       .fontSize(11)
       .fillColor(textColor)
       .text(companyLine);

    const locationAndDate = [
      exp.location,
      `${exp.startDate} - ${exp.endDate || 'Present'}`
    ].filter(Boolean).join(' | ');
    
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor(textColor)
       .text(locationAndDate);
    
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
     .fontSize(12)
     .fillColor(textColor)
     .text(languageConfig.sections.education);
  doc.moveDown(0.5);

  data.education.forEach((edu, index) => {
    if (index > 0) {
      doc.moveDown(1);
    }

    doc.font('Helvetica-Bold')
       .fontSize(11)
       .fillColor(textColor)
       .text(edu.degree);
    
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor(textColor)
       .text(edu.institution);
    
    const educationDetails = [
      edu.major,
      edu.graduationYear,
      edu.gpa ? `GPA: ${edu.gpa}` : null
    ].filter(Boolean).join(' • ');
    
    if (educationDetails) {
      doc.font('Helvetica')
         .fontSize(11)
         .fillColor(textColor)
         .text(educationDetails);
    }
    
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
       .fontSize(12)
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

  // Certifications
  if (data.certifications.length > 0) {
    doc.moveDown(1);
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .fillColor(textColor)
       .text(languageConfig.sections.certifications);
    doc.moveDown(0.5);
    
    doc.font('Helvetica')
       .fontSize(11)
       .fillColor(textColor);
    
    data.certifications.forEach((cert, index) => {
      if (index > 0) {
        doc.moveDown(1);
      }

      doc.font('Helvetica-Bold')
         .fontSize(11)
         .fillColor(textColor)
         .text(cert.name);
      
      doc.font('Helvetica')
         .fontSize(11)
         .fillColor(textColor)
         .text(cert.issuer);
      
      if (cert.issueDate) {
        doc.font('Helvetica')
           .fontSize(11)
           .fillColor(textColor)
           .text(`Issued: ${cert.issueDate}`);
      }
    });
  }
}

module.exports = generateModernTemplate; 