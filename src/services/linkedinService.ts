import { openai } from '../lib/openai';
import { callOpenAIWithRetry } from '../utils/openai';
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface LinkedInProfileData {
    name: string;
    headline: string;
    location: string;
    about: string;
    experience: Array<{
        title: string;
        company: string;
        duration: string;
        description: string;
    }>;
    education: Array<{
        institution: string;
        degree: string;
        field: string;
        duration: string;
    }>;
    skills: string[];
    connections: string;
    profileUrl: string;
}

export interface LinkedInAnalysisResult {
    profileUrl: string;
    analysisType: 'basic' | 'detailed' | 'comprehensive';
    timestamp: string;
    overallScore: number;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
    keywordOptimization: {
        currentKeywords: string[];
        suggestedKeywords: string[];
        missingKeywords: string[];
    };
    professionalPresentation: {
        headlineScore: number;
        aboutScore: number;
        experienceScore: number;
        skillsScore: number;
        overallPresentationScore: number;
    };
    detailedAnalysis?: {
        industryAlignment: string;
        careerProgression: string;
        skillGaps: string[];
        networkingOpportunities: string[];
        contentStrategy: string[];
    };
    comprehensiveInsights?: {
        marketPosition: string;
        competitiveAdvantages: string[];
        improvementAreas: string[];
        nextSteps: string[];
        industryTrends: string[];
    };
}

// Rate limiting for LinkedIn scraping
const requestQueue = new Map<string, { lastRequest: number; requestCount: number }>();
const RATE_LIMIT_DELAY = 2000; // 2 seconds between requests
const MAX_REQUESTS_PER_HOUR = 30;

async function checkRateLimit(profileUrl: string): Promise<void> {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);
    
    const existing = requestQueue.get(profileUrl) || { lastRequest: 0, requestCount: 0 };
    
    // Reset counter if it's been more than an hour
    if (existing.lastRequest < hourAgo) {
        existing.requestCount = 0;
    }
    
    // Check if we've exceeded the rate limit
    if (existing.requestCount >= MAX_REQUESTS_PER_HOUR) {
        throw new Error('Rate limit exceeded. Please try again later.');
    }
    
    // Check if we need to wait before making another request
    const timeSinceLastRequest = now - existing.lastRequest;
    if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest));
    }
    
    // Update rate limit tracking
    requestQueue.set(profileUrl, {
        lastRequest: now,
        requestCount: existing.requestCount + 1
    });
}

export async function scrapeLinkedInProfile(profileUrl: string): Promise<LinkedInProfileData> {
    await checkRateLimit(profileUrl);
    
    try {
        // Note: In production, you would use a proper LinkedIn scraping service
        // or LinkedIn's official API. This is a simplified example.
        const response = await axios.get(profileUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        
        // Extract profile data (this is a simplified version)
        // In reality, LinkedIn's HTML structure is complex and changes frequently
        const name = $('h1.text-heading-xlarge').text().trim() || 'Name not found';
        const headline = $('.text-body-medium.break-words').first().text().trim() || 'Headline not found';
        const location = $('.text-body-small.inline.t-black--light.break-words').text().trim() || 'Location not found';
        const about = $('.pv-about-section .pv-about__summary-text').text().trim() || 'About section not found';
        
        // Extract experience
        const experience: Array<{title: string; company: string; duration: string; description: string}> = [];
        $('.pv-entity__summary-info').each((_, element) => {
            const title = $(element).find('.pv-entity__summary-info h3').text().trim();
            const company = $(element).find('.pv-entity__secondary-title').text().trim();
            const duration = $(element).find('.pv-entity__dates span:last-child').text().trim();
            const description = $(element).find('.pv-entity__description').text().trim();
            
            if (title && company) {
                experience.push({ title, company, duration, description });
            }
        });
        
        // Extract education
        const education: Array<{institution: string; degree: string; field: string; duration: string}> = [];
        $('.pv-education-entity').each((_, element) => {
            const institution = $(element).find('.pv-entity__school-name').text().trim();
            const degree = $(element).find('.pv-entity__degree-name').text().trim();
            const field = $(element).find('.pv-entity__fos').text().trim();
            const duration = $(element).find('.pv-entity__dates span:last-child').text().trim();
            
            if (institution) {
                education.push({ institution, degree, field, duration });
            }
        });
        
        // Extract skills
        const skills: string[] = [];
        $('.pv-skill-category-entity__name').each((_, element) => {
            const skill = $(element).text().trim();
            if (skill) {
                skills.push(skill);
            }
        });
        
        // Extract connections count
        const connections = $('.pv-top-card--list-bullet .t-bold').first().text().trim() || 'Connections not found';
        
        return {
            name,
            headline,
            location,
            about,
            experience,
            education,
            skills,
            connections,
            profileUrl
        };
        
    } catch (error: any) {
        if (error.response?.status === 404) {
            throw new Error('LinkedIn profile not found or not accessible');
        }
        if (error.response?.status === 429) {
            throw new Error('Rate limit exceeded. Please try again later.');
        }
        throw new Error(`Failed to scrape LinkedIn profile: ${error.message}`);
    }
}

export async function analyzeLinkedInProfile(
    profileUrl: string, 
    analysisType: 'basic' | 'detailed' | 'comprehensive' = 'basic',
    isPremium: boolean = false
): Promise<LinkedInAnalysisResult> {
    try {
        // For demo purposes, we'll create mock data instead of actual scraping
        // In production, you would call scrapeLinkedInProfile(profileUrl)
        const mockProfileData: LinkedInProfileData = {
            name: "John Doe",
            headline: "Senior Software Engineer | Full Stack Developer | React & Node.js Expert",
            location: "San Francisco, CA",
            about: "Passionate software engineer with 5+ years of experience building scalable web applications. Expert in React, Node.js, and cloud technologies. Always learning and adapting to new technologies.",
            experience: [
                {
                    title: "Senior Software Engineer",
                    company: "Tech Corp",
                    duration: "2021 - Present",
                    description: "Led development of microservices architecture, improved system performance by 40%"
                },
                {
                    title: "Software Engineer",
                    company: "StartupXYZ",
                    duration: "2019 - 2021",
                    description: "Developed full-stack applications using React and Node.js"
                }
            ],
            education: [
                {
                    institution: "University of California",
                    degree: "Bachelor of Science",
                    field: "Computer Science",
                    duration: "2015 - 2019"
                }
            ],
            skills: ["JavaScript", "React", "Node.js", "Python", "AWS", "Docker", "Kubernetes"],
            connections: "500+",
            profileUrl
        };

        // Generate AI analysis based on profile data
        const analysisResult = await generateAIAnalysis(mockProfileData, analysisType, isPremium);
        
        return {
            ...analysisResult,
            profileUrl,
            analysisType,
            timestamp: new Date().toISOString()
        };
        
    } catch (error: any) {
        console.error('LinkedIn analysis error:', error);
        throw new Error(`Analysis failed: ${error.message}`);
    }
}

async function generateAIAnalysis(
    profileData: LinkedInProfileData, 
    analysisType: 'basic' | 'detailed' | 'comprehensive',
    isPremium: boolean
): Promise<Omit<LinkedInAnalysisResult, 'profileUrl' | 'analysisType' | 'timestamp'>> {
    
    const systemMessage = `You are a professional LinkedIn profile analyst and career coach. Analyze the provided LinkedIn profile data and provide structured feedback to help improve the person's professional presence and career prospects.`;
    
    let prompt = `Analyze this LinkedIn profile and provide a structured analysis:

Profile Data:
- Name: ${profileData.name}
- Headline: ${profileData.headline}
- Location: ${profileData.location}
- About: ${profileData.about}
- Experience: ${JSON.stringify(profileData.experience)}
- Education: ${JSON.stringify(profileData.education)}
- Skills: ${profileData.skills.join(', ')}
- Connections: ${profileData.connections}

Please provide a JSON response with the following structure:
{
  "overallScore": 85,
  "strengths": ["Strong technical skills", "Clear career progression"],
  "weaknesses": ["Limited leadership experience", "Could improve networking"],
  "recommendations": ["Add more quantifiable achievements", "Expand professional network"],
  "keywordOptimization": {
    "currentKeywords": ["JavaScript", "React", "Node.js"],
    "suggestedKeywords": ["TypeScript", "Microservices", "DevOps"],
    "missingKeywords": ["Leadership", "Team Management", "Agile"]
  },
  "professionalPresentation": {
    "headlineScore": 80,
    "aboutScore": 75,
    "experienceScore": 85,
    "skillsScore": 90,
    "overallPresentationScore": 82
  }`;

    if (analysisType === 'detailed' && isPremium) {
        prompt += `\n\nAdditionally, provide detailed analysis:
  "detailedAnalysis": {
    "industryAlignment": "Analysis of how well the profile aligns with industry standards",
    "careerProgression": "Assessment of career growth and trajectory",
    "skillGaps": ["Missing skills for target roles"],
    "networkingOpportunities": ["Suggestions for expanding professional network"],
    "contentStrategy": ["Recommendations for profile content improvements"]
  }`;
    }

    if (analysisType === 'comprehensive' && isPremium) {
        prompt += `\n\nAdditionally, provide comprehensive insights:
  "comprehensiveInsights": {
    "marketPosition": "Analysis of market position and competitiveness",
    "competitiveAdvantages": ["Unique strengths and differentiators"],
    "improvementAreas": ["Specific areas for professional development"],
    "nextSteps": ["Actionable next steps for career advancement"],
    "industryTrends": ["Relevant industry trends and how to leverage them"]
  }`;
    }

    try {
        const response = await callOpenAIWithRetry(prompt, systemMessage, {
            model: 'gpt-4',
            temperature: 0.3,
            maxTokens: analysisType === 'comprehensive' ? 2000 : analysisType === 'detailed' ? 1500 : 1000,
            maxRetries: 2
        });

        if (!response) {
            throw new Error('Failed to generate AI analysis');
        }

        // Parse the JSON response
        const analysis = JSON.parse(response);
        
        // Validate and structure the response
        return {
            overallScore: analysis.overallScore || 0,
            strengths: analysis.strengths || [],
            weaknesses: analysis.weaknesses || [],
            recommendations: analysis.recommendations || [],
            keywordOptimization: analysis.keywordOptimization || {
                currentKeywords: [],
                suggestedKeywords: [],
                missingKeywords: []
            },
            professionalPresentation: analysis.professionalPresentation || {
                headlineScore: 0,
                aboutScore: 0,
                experienceScore: 0,
                skillsScore: 0,
                overallPresentationScore: 0
            },
            ...(analysisType === 'detailed' && isPremium && analysis.detailedAnalysis ? {
                detailedAnalysis: analysis.detailedAnalysis
            } : {}),
            ...(analysisType === 'comprehensive' && isPremium && analysis.comprehensiveInsights ? {
                comprehensiveInsights: analysis.comprehensiveInsights
            } : {})
        };
        
    } catch (error: any) {
        console.error('AI analysis generation error:', error);
        
        // Return a basic analysis if AI fails
        return {
            overallScore: 70,
            strengths: ["Profile has good structure", "Relevant experience listed"],
            weaknesses: ["Could use more specific achievements", "Limited networking indicators"],
            recommendations: ["Add quantifiable achievements", "Expand professional network", "Optimize keywords"],
            keywordOptimization: {
                currentKeywords: profileData.skills.slice(0, 5),
                suggestedKeywords: ["Leadership", "Management", "Strategy"],
                missingKeywords: ["Team Building", "Project Management"]
            },
            professionalPresentation: {
                headlineScore: 75,
                aboutScore: 70,
                experienceScore: 80,
                skillsScore: 85,
                overallPresentationScore: 77
            }
        };
    }
}
