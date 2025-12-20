const PDFDocument = require('pdfkit');
const { getLanguageConfig } = require('../utils/language');

function generateColorfulTemplate(data, doc, language = 'en') {
  const languageConfig = getLanguageConfig(language);
  const sectionTitles = languageConfig.sections || {};
  
  // Colors
  const primaryColor = '#2E86AB'; // Blue accent color
  const textColor = '#000000';
  const lightGray = '#F5F5F5';
  
  // Dimensions
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const margin = 50;
  const columnWidth = (pageWidth - 2 * margin) / 2;
  const leftColumnX = margin;
  const rightColumnX = margin + columnWidth + 20; // 20px gap between columns
  
  // Helper function to draw circular logo with initials (removed for now)
  function drawLogo(x, y, size, initials) {
    // Logo removed as requested
  }
  
  // Helper: draw skill boxes
  function drawSkillBoxes(skills, startX, startY, maxWidth) {
    let currentX = startX;
    let currentY = startY;
    const boxHeight = 16;
    const boxPadding = 6;
    const boxMargin = 3;
    
    skills.forEach((skill, index) => {
      const skillText = skill.name;
      const textWidth = doc.font('Helvetica').fontSize(8).widthOfString(skillText);
      const boxWidth = textWidth + boxPadding * 2;
      
      // Check if we need to wrap to next line
      if (currentX + boxWidth > startX + maxWidth) {
        currentX = startX;
        currentY += boxHeight + boxMargin;
      }
      
      // Draw skill box
      doc.save();
      doc.roundedRect(currentX, currentY, boxWidth, boxHeight, 3) // Smaller radius
         .fill(lightGray);
      doc.font('Helvetica')
         .fontSize(8) // Smaller font size
         .fillColor(textColor)
         .text(skillText, currentX + boxPadding, currentY + 4);
      doc.restore();
      
      currentX += boxWidth + boxMargin;
    });
    
    return currentY + boxHeight + 8; // Return the Y position after the last box
  }

  // Helper: split description into tasks
  function splitDescriptionToTasks(description) {
    if (!description) return [];
    const normalized = String(description).replace(/\r\n/g, '\n');
    if (normalized.includes('\n')) {
      return normalized.split('\n').map(s => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
    }
    if (normalized.includes('•')) {
      return normalized.split('•').map(s => s.trim()).filter(Boolean);
    }
    if (normalized.includes(' - ')) {
      return normalized.split(' - ').map(s => s.trim()).filter(Boolean);
    }
    return normalized.split(/\.\s+/).map(s => s.trim()).filter(Boolean);
  }

  // Helper: draw bulleted list and return resulting Y
  function drawBulletList(tasks, startX, startY, maxWidth) {
    let currentY = startY;
    const bulletIndent = 10;
    const lineGap = 2;
    tasks.forEach(task => {
      const bullet = '•';
      doc.font('Helvetica').fontSize(9).fillColor(textColor).text(bullet, startX, currentY);
      doc.font('Helvetica').fontSize(9).fillColor(textColor).text(task, startX + bulletIndent, currentY, {
        width: maxWidth - bulletIndent,
        align: 'left'
      });
      const height = doc.heightOfString(task, {
        width: maxWidth - bulletIndent,
        align: 'left'
      });
      currentY += height + lineGap;
    });
    return currentY;
  }
  
  // Helper function to draw language proficiency
  function drawLanguageProficiency(language, startX, startY) {
    const proficiencyLevels = {
      'Beginner': 1,
      'Elementary': 2,
      'Intermediate': 3,
      'Advanced': 4,
      'Native': 5
    };
    
    const level = proficiencyLevels[language.proficiency] || 3;
    const circleRadius = 3;
    const circleSpacing = 8;
    
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor(textColor)
       .text(language.name, startX, startY);
    
    doc.font('Helvetica')
       .fontSize(8)
       .fillColor(textColor)
       .text(language.proficiency, startX + 80, startY);
    
    // Draw proficiency circles
    for (let i = 0; i < 5; i++) {
      const circleX = startX + 120 + (i * circleSpacing);
      const circleY = startY + 2;
      
      if (i < level) {
        doc.circle(circleX, circleY, circleRadius)
           .fill(primaryColor);
      } else {
        doc.circle(circleX, circleY, circleRadius)
           .stroke('#CCCCCC')
           .lineWidth(0.5);
      }
    }
  }
  
  // Header Section
  const headerY = margin;
  
  // Name and Title
  doc.font('Helvetica-Bold')
     .fontSize(28)
     .fillColor(textColor)
     .text(data.fullName.toUpperCase(), leftColumnX, headerY);

  // Derive a role/headline if provided; fall back to first experience job title
  const headline = (data.title || data.profession || data.role || (data.workExperience && data.workExperience[0] && data.workExperience[0].jobTitle)) || '';
  if (headline) {
    doc.font('Helvetica')
       .fontSize(14)
       .fillColor(primaryColor)
       .text(headline, leftColumnX, headerY + 35);
  }
  
  // Contact Information - on same line under name
  const contactY = headerY + 50;
  const contactItems = [
    data.phone,
    data.email,
    data.linkedIn,
    data.address,
    data.website
  ].filter(Boolean);
  
  doc.font('Helvetica')
     .fontSize(10)
     .fillColor(textColor);
  
  const contactText = contactItems.join(' | ');
  doc.text(contactText, leftColumnX, contactY);
  
  // Right Column - Summary
  const summaryY = headerY + 64;
  doc.font('Helvetica-Bold')
     .fontSize(12)
     .fillColor(textColor)
     .text(sectionTitles.professionalSummary || 'SUMMARY', rightColumnX, summaryY);
  
  const summaryText = data.summary || '';
  const summaryHeight = doc.heightOfString(summaryText || ' ', {
    width: columnWidth - 20,
    align: 'left'
  });
  
  doc.font('Helvetica')
     .fontSize(10)
     .fillColor(textColor)
     .text(summaryText, rightColumnX, summaryY + 15, {
       width: columnWidth - 20,
       align: 'left'
     });
  
  // Right Column - Languages
  const languagesY = summaryY + 15 + summaryHeight + 18;
  doc.font('Helvetica-Bold')
     .fontSize(12)
     .fillColor(textColor)
     .text(sectionTitles.languages || 'LANGUAGES', rightColumnX, languagesY);
  
  if (data.languages && data.languages.length > 0) {
    const { localizeLanguageName, localizeProficiency } = require('../utils/language');
    data.languages.forEach((language, index) => {
      const localized = {
        name: localizeLanguageName(language.name, language),
        proficiency: localizeProficiency(language.proficiency, language)
      };
      drawLanguageProficiency(localized, rightColumnX, languagesY + 20 + (index * 20));
    });
  }
  
  // Right Column - Skills
  const skillsY = languagesY + (data.languages ? data.languages.length * 18 + 18 : 36);
  doc.font('Helvetica-Bold')
     .fontSize(12)
     .fillColor(textColor)
     .text(sectionTitles.skills || 'SKILLS', rightColumnX, skillsY);
  
  if (data.skills && data.skills.length > 0) {
    drawSkillBoxes(data.skills, rightColumnX, skillsY + 15, columnWidth - 20);
  }
  
  // Left Column - Experience
  const experienceY = headerY + 64;
  doc.font('Helvetica-Bold')
     .fontSize(16)
     .fillColor(textColor)
     .text(sectionTitles.professionalExperience || 'EXPERIENCE', leftColumnX, experienceY);
  
  let currentY = experienceY + 22;
  const spacingBetweenEntries = 12;
  if (data.workExperience && data.workExperience.length > 0) {
    data.workExperience.forEach((exp) => {
      // Page break if near bottom
      if (currentY > pageHeight - 120) {
        doc.addPage();
        currentY = margin;
      }

      doc.font('Helvetica-Bold').fontSize(12).fillColor(textColor).text(exp.jobTitle || '', leftColumnX, currentY);
      currentY += 12;

      const companyLine = [exp.company || '', exp.companyDescription || ''].filter(Boolean).join(' | ');
      doc.font('Helvetica').fontSize(10).fillColor(primaryColor).text(companyLine, leftColumnX, currentY);
      currentY += 12;

      const dateRange = `${exp.startDate ? new Date(exp.startDate).getUTCFullYear() : ''} - ${exp.endDate && exp.endDate !== 'Present' ? new Date(exp.endDate).getUTCFullYear() : 'Present'}`;
      doc.font('Helvetica').fontSize(9).fillColor(textColor).text(dateRange, leftColumnX, currentY);
      currentY += 10;

      // companyDescription is now shown next to company

      const cleanDescription = (() => {
        const cd = (exp.companyDescription || '').toString().trim();
        if (!cd) return exp.description || '';
        try {
          const re = new RegExp(cd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
          return (exp.description || '').replace(re, '').trim();
        } catch (_) {
          return exp.description || '';
        }
      })();

      const tasks = splitDescriptionToTasks(cleanDescription);
      if (tasks.length > 0) {
        currentY = drawBulletList(tasks, leftColumnX, currentY + 2, columnWidth - 20);
      }

      if (exp.techStack) {
        const { getLanguageConfig } = require('../utils/language');
        const techLabel = (getLanguageConfig(language).labels && getLanguageConfig(language).labels.tech) || 'Tech';
        const techText = `${techLabel}: ${exp.techStack}`;
        const h2 = doc.heightOfString(techText, { width: columnWidth - 20, align: 'left' });
        currentY += 4;
        doc.font('Helvetica').fontSize(9).fillColor(textColor).text(techText, leftColumnX, currentY, {
          width: columnWidth - 20,
          align: 'left'
        });
        currentY += h2 + 4;
      }

      currentY += spacingBetweenEntries;
    });
  }
  
  // Education section (positioned after experience with page break handling)
  if (data.education && data.education.length > 0) {
    let educationY = currentY + 10;
    if (educationY > pageHeight - 120) {
      doc.addPage();
      educationY = margin;
    }
    doc.font('Helvetica-Bold').fontSize(16).fillColor(textColor).text(sectionTitles.education || 'EDUCATION', leftColumnX, educationY);
    let eduY = educationY + 22;
    data.education.forEach((edu) => {
      if (eduY > pageHeight - 120) {
        doc.addPage();
        eduY = margin;
      }
      doc.font('Helvetica-Bold').fontSize(12).fillColor(textColor).text(edu.degree || '', leftColumnX, eduY);
      eduY += 12;
      doc.font('Helvetica').fontSize(10).fillColor(primaryColor).text(edu.institution || '', leftColumnX, eduY);
      eduY += 12;
      const gradYear = edu.graduationYear ? edu.graduationYear.toString() : '';
      doc.font('Helvetica').fontSize(9).fillColor(textColor).text(gradYear, leftColumnX, eduY);
      eduY += 14;
      if (edu.description) {
        doc.font('Helvetica').fontSize(9).fillColor(textColor).text(edu.description, leftColumnX, eduY, {
          width: columnWidth - 20,
          align: 'left'
        });
        const h = doc.heightOfString(edu.description, { width: columnWidth - 20, align: 'left' });
        eduY += h + 6;
      }
    });
  }
}

module.exports = generateColorfulTemplate;
