const PDFDocument = require('pdfkit');

function generateModernTemplate(data, doc) {
  // Set up fonts and colors
  doc.font('Helvetica-Bold');
  doc.fontSize(24);
  doc.text(data.fullName, { align: 'center' });
  
  // Contact information
  doc.font('Helvetica');
  doc.fontSize(10);
  const contactInfo = [
    data.email,
    data.phone,
    data.address,
    data.linkedIn,
    data.website
  ].filter(Boolean).join(' • ');
  doc.text(contactInfo, { align: 'center' });
  
  // Summary
  if (data.summary) {
    doc.moveDown();
    doc.font('Helvetica-Bold');
    doc.fontSize(12);
    doc.text('Professional Summary');
    doc.font('Helvetica');
    doc.fontSize(10);
    doc.text(data.summary);
  }

  // Skills
  if (data.skills && data.skills.length > 0) {
    doc.moveDown();
    doc.font('Helvetica-Bold');
    doc.fontSize(12);
    doc.text('Skills');
    doc.font('Helvetica');
    doc.fontSize(10);
    doc.text(data.skills.map(skill => skill.name).join(' • '));
  }

  // Work Experience
  if (data.workExperience && data.workExperience.length > 0) {
    doc.moveDown();
    doc.font('Helvetica-Bold');
    doc.fontSize(12);
    doc.text('Work Experience');
    
    data.workExperience.forEach(exp => {
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold');
      doc.fontSize(11);
      doc.text(exp.jobTitle);
      doc.font('Helvetica');
      doc.fontSize(10);
      doc.text(`${exp.company} | ${exp.startDate} - ${exp.endDate || 'Present'}`);
      
      if (exp.description) {
        doc.moveDown(0.5);
        const bullets = exp.description.split('\n');
        bullets.forEach(bullet => {
          doc.text(`• ${bullet.replace(/^•\s*/, '')}`, {
            indent: 20,
            continued: false
          });
        });
      }
    });
  }

  // Education
  if (data.education && data.education.length > 0) {
    doc.moveDown();
    doc.font('Helvetica-Bold');
    doc.fontSize(12);
    doc.text('Education');
    
    data.education.forEach(edu => {
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold');
      doc.fontSize(11);
      doc.text(edu.degree);
      doc.font('Helvetica');
      doc.fontSize(10);
      const eduDetails = [
        edu.institution,
        edu.major,
        edu.graduationYear
      ].filter(Boolean).join(' | ');
      doc.text(eduDetails);
    });
  }

  // Languages
  if (data.languages && data.languages.length > 0) {
    doc.moveDown();
    doc.font('Helvetica-Bold');
    doc.fontSize(12);
    doc.text('Languages');
    doc.font('Helvetica');
    doc.fontSize(10);
    data.languages.forEach(lang => {
      doc.text(`${lang.name} - ${lang.proficiency}`);
    });
  }

  // Certifications
  if (data.certifications && data.certifications.length > 0) {
    doc.moveDown();
    doc.font('Helvetica-Bold');
    doc.fontSize(12);
    doc.text('Certifications');
    
    data.certifications.forEach(cert => {
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold');
      doc.fontSize(11);
      doc.text(cert.name);
      doc.font('Helvetica');
      doc.fontSize(10);
      const certDetails = [
        cert.issuer,
        cert.issueDate
      ].filter(Boolean).join(' | ');
      doc.text(certDetails);
    });
  }
}

module.exports = generateModernTemplate; 