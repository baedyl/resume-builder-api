const PDFDocument = require('pdfkit');
const { getLanguageConfig } = require('../utils/language');

function generateClassicTemplate(data, doc, language = 'en') {
  const languageConfig = getLanguageConfig(language);
  
  // ATS-friendly: Use only black text for maximum compatibility
  const textColor = '#000000';
  
  // Header
  doc.font('Times-Bold')
     .fontSize(24)
     .fillColor(textColor)
     .text(data.fullName, { align: 'center' });
  
  // Contact information
  doc.font('Times-Roman')
     .fontSize(11)
     .fillColor(textColor);
  
  const contactInfo = [
    data.email,
    data.phone,
    data.address,
    data.linkedIn,
    data.website
  ].filter(Boolean).join(' | ');
  
  doc.text(contactInfo, { align: 'center' });
  doc.moveDown(1);
  
  // ATS-friendly: Use simple line separator
  doc.strokeColor(textColor)
     .lineWidth(1)
     .moveTo(50, doc.y)
     .lineTo(545, doc.y)
     .stroke();
  doc.moveDown(1);
  
  // Summary
  if (data.summary) {
    doc.font('Times-Bold')
       .fontSize(12)
       .fillColor(textColor)
       .text(languageConfig.sections.professionalSummary);
    
    doc.moveDown(0.5);
    doc.font('Times-Roman')
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
       .lineWidth(1)
       .moveTo(50, doc.y)
       .lineTo(545, doc.y)
       .stroke();
    doc.moveDown(1);
    
    doc.font('Times-Bold')
       .fontSize(12)
       .fillColor(textColor)
       .text(languageConfig.sections.skills);
    
    doc.moveDown(0.5);
    doc.font('Times-Roman')
       .fontSize(11)
       .fillColor(textColor)
       .text(data.skills.map(skill => skill.name).join(', '), {
         lineGap: 2
       });
    doc.moveDown(1);
  }

  // Languages
  if (data.languages.length > 0) {
    doc.moveDown(1);
    // Add separator before Languages section
    doc.strokeColor(textColor)
       .lineWidth(1)
       .moveTo(50, doc.y)
       .lineTo(545, doc.y)
       .stroke();
    doc.moveDown(1);
    
    doc.font('Times-Bold')
       .fontSize(12)
       .fillColor(textColor)
       .text(languageConfig.sections.languages);
    doc.moveDown(0.5);
    
    doc.font('Times-Roman')
       .fontSize(11)
       .fillColor(textColor);
    
    data.languages.forEach(lang => {
      doc.text(`${lang.name} - ${lang.proficiency}`, {
        lineGap: 2
      });
    });
  }

  // Work Experience
  // Add separator before Professional Experience section
  doc.strokeColor(textColor)
     .lineWidth(1)
     .moveTo(50, doc.y)
     .lineTo(545, doc.y)
     .stroke();
  doc.moveDown(1);
  
  doc.font('Times-Bold')
     .fontSize(12)
     .fillColor(textColor)
     .text(languageConfig.sections.professionalExperience);
  doc.moveDown(0.5);
  
  data.workExperience.forEach((exp, index) => {
    if (index > 0) {
      doc.moveDown(1);
    }

    doc.font('Times-Bold')
       .fontSize(11)
       .fillColor(textColor)
       .text(exp.jobTitle);
    
    const companyLine = [
      exp.company,
      exp.companyDescription
    ].filter(Boolean).join(' | ');

    doc.font('Times-Roman')
       .fontSize(11)
       .fillColor(textColor)
       .text(companyLine);

    const companyAndDate = [
      exp.location,
      `${exp.startDate} - ${exp.endDate || 'Present'}`
    ].filter(Boolean).join(' | ');
    
    doc.font('Times-Roman')
       .fontSize(11)
       .fillColor(textColor)
       .text(companyAndDate);
    
    if (exp.location) {
      doc.font('Times-Roman')
         .fontSize(11)
         .fillColor(textColor)
         .text(exp.location);
    }
    
    doc.moveDown(0.5);
    
    if (exp.description) {
      doc.font('Times-Roman')
         .fontSize(11)
         .fillColor(textColor)
          .text((() => {
            return exp.description;
          })(), {
           align: 'justify',
           lineGap: 2
         });
    }

    if (exp.techStack) {
      const { getLanguageConfig } = require('../utils/language');
      const techLabel = (getLanguageConfig(language).labels && getLanguageConfig(language).labels.tech) || 'Tech';
      doc.font('Times-Roman')
         .fontSize(10)
         .fillColor(textColor)
         .text(`${techLabel}: ${exp.techStack}`);
    }
  });

  doc.moveDown(1);

  // Education
  // Add separator before Education section
  doc.strokeColor(textColor)
     .lineWidth(1)
     .moveTo(50, doc.y)
     .lineTo(545, doc.y)
     .stroke();
  doc.moveDown(1);
  
  doc.font('Times-Bold')
     .fontSize(12)
     .fillColor(textColor)
     .text(languageConfig.sections.education);
  doc.moveDown(0.5);
  
  data.education.forEach((edu, index) => {
    if (index > 0) {
      doc.moveDown(1);
    }

    doc.font('Times-Bold')
       .fontSize(11)
       .fillColor(textColor)
       .text(edu.degree);
    
    const educationDetails = [
      edu.institution,
      edu.major,
      edu.graduationYear,
      edu.gpa ? `GPA: ${edu.gpa}` : null
    ].filter(Boolean).join(' | ');
    
    doc.font('Times-Roman')
       .fontSize(11)
       .fillColor(textColor)
       .text(educationDetails);
    
    if (edu.description) {
      doc.moveDown(0.5);
      doc.font('Times-Roman')
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
    doc.font('Times-Bold')
       .fontSize(12)
       .fillColor(textColor)
       .text(languageConfig.sections.certifications);
    doc.moveDown(0.5);
    
    data.certifications.forEach((cert, index) => {
      if (index > 0) {
        doc.moveDown(1);
      }

      doc.font('Times-Bold')
         .fontSize(11)
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

      const certDetails = [
        cert.issuer,
        issueYear
      ].filter(Boolean).join(' | ');

      doc.font('Times-Roman')
         .fontSize(11)
         .fillColor(textColor)
         .text(certDetails);
    });
  }
}

module.exports = generateClassicTemplate; 