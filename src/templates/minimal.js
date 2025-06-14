const PDFDocument = require('pdfkit');

function generateMinimalTemplate(data, doc) {
  // Set up fonts and colors
  doc.font('Helvetica-Bold');
  doc.fontSize(20);
  doc.text(data.fullName, { align: 'left' });
  
  // Contact information
  doc.font('Helvetica');
  doc.fontSize(9);
  const contactInfo = [
    data.email,
    data.phone,
    data.address,
    data.linkedIn,
    data.website
  ].filter(Boolean).join(' | ');
  doc.text(contactInfo);
  
  // Summary
  if (data.summary) {
    doc.moveDown();
    doc.fontSize(10);
    doc.text(data.summary);
  }

  // Skills
  if (data.skills && data.skills.length > 0) {
    doc.moveDown();
    doc.fontSize(10);
    doc.text('Skills: ' + data.skills.map(skill => skill.name).join(', '));
  }

  // Work Experience
  if (data.workExperience && data.workExperience.length > 0) {
    doc.moveDown();
    doc.fontSize(11);
    doc.font('Helvetica-Bold');
    doc.text('Experience');
    doc.font('Helvetica');
    
    data.workExperience.forEach(exp => {
      doc.moveDown(0.5);
      doc.fontSize(10);
      doc.text(`${exp.jobTitle} at ${exp.company}`);
      doc.fontSize(9);
      doc.text(`${exp.startDate} - ${exp.endDate || 'Present'}`);
      
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
    doc.fontSize(11);
    doc.font('Helvetica-Bold');
    doc.text('Education');
    doc.font('Helvetica');
    
    data.education.forEach(edu => {
      doc.moveDown(0.5);
      doc.fontSize(10);
      doc.font('Helvetica-Bold');
      doc.text(edu.degree);
      doc.font('Helvetica');
      doc.fontSize(9);
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
    doc.fontSize(11);
    doc.font('Helvetica-Bold');
    doc.text('Languages');
    doc.font('Helvetica');
    doc.fontSize(9);
    data.languages.forEach(lang => {
      doc.text(`${lang.name} - ${lang.proficiency}`);
    });
  }

  // Certifications
  if (data.certifications && data.certifications.length > 0) {
    doc.moveDown();
    doc.fontSize(11);
    doc.font('Helvetica-Bold');
    doc.text('Certifications');
    doc.font('Helvetica');
    data.certifications.forEach(cert => {
      doc.moveDown(0.5);
      doc.fontSize(10);
      doc.text(cert.name);
      doc.fontSize(9);
      const certDetails = [
        cert.issuer,
        cert.issueDate
      ].filter(Boolean).join(' | ');
      doc.text(certDetails);
    });
  }
}

module.exports = generateMinimalTemplate; 