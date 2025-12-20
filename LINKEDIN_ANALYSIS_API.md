# LinkedIn Profile Analysis API

## Overview

The LinkedIn Profile Analysis API provides AI-powered analysis of LinkedIn profiles to help users optimize their professional presence and career prospects. The API includes rate limiting, caching, and premium features for detailed analysis.

## Features

- **AI-Powered Analysis**: Uses OpenAI GPT-4 to analyze LinkedIn profiles
- **Rate Limiting**: Prevents abuse with configurable rate limits
- **Caching**: 24-hour cache for analysis results to improve performance
- **Premium Features**: Detailed and comprehensive analysis for premium users
- **Multiple Analysis Types**: Basic, detailed, and comprehensive analysis levels

## Endpoints

### 1. Analyze LinkedIn Profile

**POST** `/api/linkedin/analyze`

Analyzes a LinkedIn profile and returns structured feedback.

#### Request Body

```json
{
  "profileUrl": "https://linkedin.com/in/username",
  "analysisType": "basic" // optional: "basic" | "detailed" | "comprehensive"
}
```

#### Response

```json
{
  "profileUrl": "https://linkedin.com/in/username",
  "analysisType": "basic",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "overallScore": 85,
  "strengths": [
    "Strong technical skills",
    "Clear career progression",
    "Relevant experience"
  ],
  "weaknesses": [
    "Limited leadership experience",
    "Could improve networking"
  ],
  "recommendations": [
    "Add more quantifiable achievements",
    "Expand professional network",
    "Optimize keywords for better visibility"
  ],
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
  }
}
```

#### Premium Features (Detailed Analysis)

For `analysisType: "detailed"` (premium users only):

```json
{
  // ... basic analysis fields
  "detailedAnalysis": {
    "industryAlignment": "Profile aligns well with software engineering standards",
    "careerProgression": "Shows steady growth from junior to senior level",
    "skillGaps": ["Leadership experience", "Cloud architecture"],
    "networkingOpportunities": ["Join industry groups", "Attend conferences"],
    "contentStrategy": ["Share technical articles", "Engage with industry content"]
  }
}
```

#### Premium Features (Comprehensive Analysis)

For `analysisType: "comprehensive"` (premium users only):

```json
{
  // ... basic and detailed analysis fields
  "comprehensiveInsights": {
    "marketPosition": "Strong mid-level developer with growth potential",
    "competitiveAdvantages": ["Full-stack expertise", "Modern tech stack"],
    "improvementAreas": ["Leadership skills", "Industry networking"],
    "nextSteps": ["Pursue management training", "Build thought leadership"],
    "industryTrends": ["AI/ML integration", "Cloud-native development"]
  }
}
```

### 2. Get Cached Analysis

**GET** `/api/linkedin/analysis/:id`

Retrieves a previously cached analysis by ID.

#### Response

```json
{
  // ... analysis result
  "cached": true,
  "cacheExpiry": "2024-01-16T10:30:00.000Z"
}
```

### 3. List User Analyses

**GET** `/api/linkedin/analyses`

Lists all cached analyses for the authenticated user.

#### Response

```json
{
  "analyses": [
    {
      "id": "https://linkedin.com/in/username:basic",
      "timestamp": 1705312200000,
      "cacheExpiry": "2024-01-16T10:30:00.000Z",
      "analysisType": "basic"
    }
  ],
  "total": 1
}
```

### 4. Clear Cached Analysis

**DELETE** `/api/linkedin/analysis/:id`

Removes a cached analysis from the cache.

#### Response

```json
{
  "message": "Analysis cache cleared successfully"
}
```

## Rate Limiting

The API implements rate limiting to prevent abuse:

- **LinkedIn Analysis**: 10 requests per minute per user
- **General API**: 100 requests per 15 minutes per user
- **Auth Endpoints**: 5 requests per minute per user

### Rate Limit Headers

All responses include rate limiting headers:

```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 2024-01-15T10:35:00.000Z
X-RateLimit-Warning: Approaching rate limit (when applicable)
```

### Rate Limit Exceeded Response

```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again after 2024-01-15T10:35:00.000Z",
  "retryAfter": 300,
  "limit": 10,
  "remaining": 0,
  "resetTime": "2024-01-15T10:35:00.000Z"
}
```

## Authentication

All endpoints require authentication via JWT token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

## Premium Features

- **Basic Analysis**: Available to all users
- **Detailed Analysis**: Requires premium subscription
- **Comprehensive Analysis**: Requires premium subscription

### Premium Check Response

```json
{
  "error": "Premium subscription required for detailed analysis",
  "upgradeUrl": "/upgrade",
  "availableTypes": ["basic"]
}
```

## Error Handling

### Common Error Responses

#### 400 Bad Request
```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "profileUrl",
      "message": "Invalid URL format"
    }
  ]
}
```

#### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "Valid authentication token required"
}
```

#### 403 Forbidden
```json
{
  "error": "Premium subscription required",
  "upgradeUrl": "/upgrade"
}
```

#### 404 Not Found
```json
{
  "error": "LinkedIn profile not found or not accessible",
  "suggestions": [
    "Verify the profile URL is correct",
    "Ensure the profile is public",
    "Check if the profile exists"
  ]
}
```

#### 429 Too Many Requests
```json
{
  "error": "Rate limit exceeded",
  "retryAfter": 60
}
```

#### 500 Internal Server Error
```json
{
  "error": "Failed to analyze LinkedIn profile",
  "message": "Analysis service temporarily unavailable"
}
```

## Caching

- Analysis results are cached for 24 hours
- Cache keys include user ID, profile URL, and analysis type
- Cache is automatically cleaned up when it exceeds 1000 entries
- Cached results include `cached: true` and `cacheExpiry` fields

## Usage Examples

### Basic Analysis

```bash
curl -X POST http://localhost:3000/api/linkedin/analyze \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "profileUrl": "https://linkedin.com/in/johndoe",
    "analysisType": "basic"
  }'
```

### Detailed Analysis (Premium)

```bash
curl -X POST http://localhost:3000/api/linkedin/analyze \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "profileUrl": "https://linkedin.com/in/johndoe",
    "analysisType": "detailed"
  }'
```

### Get Cached Analysis

```bash
curl -X GET http://localhost:3000/api/linkedin/analysis/https://linkedin.com/in/johndoe:basic \
  -H "Authorization: Bearer <token>"
```

## Implementation Notes

### LinkedIn Scraping

The current implementation uses mock data for demonstration purposes. In production, you would need to:

1. Use LinkedIn's official API (if available)
2. Implement proper web scraping with rotating proxies
3. Handle LinkedIn's anti-bot measures
4. Respect LinkedIn's Terms of Service

### AI Analysis

The AI analysis uses OpenAI's GPT-4 model with:
- Temperature: 0.3 (for consistent results)
- Max tokens: 1000-2000 depending on analysis type
- Retry logic with exponential backoff
- Fallback to basic analysis if AI fails

### Security Considerations

- Rate limiting prevents abuse
- User authentication required
- Input validation for URLs
- Premium feature gating
- Cache isolation by user ID

## Future Enhancements

- Integration with LinkedIn's official API
- Real-time profile monitoring
- Industry-specific analysis templates
- Export analysis to PDF
- Integration with resume builder
- A/B testing for profile optimization
- Social media cross-platform analysis
