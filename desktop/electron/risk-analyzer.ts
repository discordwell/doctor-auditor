import { v4 as uuidv4 } from "uuid";
import type {
  TranscriptSegment,
  RiskAssessment,
  RiskCategoryScore,
  DeidentifiedAssessment,
} from "./contracts";

interface OllamaResponse {
  message?: { content: string };
  response?: string;
}

const RISK_ANALYSIS_PROMPT = `You are a medical malpractice risk analyst. Analyze the following doctor-patient conversation transcript and score the doctor's behavior across three categories.

For each category, provide a score from 1 (lowest risk) to 10 (highest risk) and list specific flags/issues detected.

## Categories

### Communication (score 1-10)
Look for: dismissiveness, not explaining procedures/risks, rushing, poor bedside manner, not listening, interrupting the patient.

### Clinical (score 1-10)
Look for: skipping standard assessment questions, not discussing medication side effects, ignoring/minimizing symptoms, premature diagnosis, not ordering follow-ups.

### Behavioral (score 1-10)
Look for: signs of impairment (slurred speech, confusion), fatigue, frustration/anger/hostility, inappropriate comments, emotional instability.

## Transcript
{transcript}

## Response Format
Respond ONLY with valid JSON in this exact format:
{
  "communication": { "score": <1-10>, "flags": ["<issue1>", "<issue2>"] },
  "clinical": { "score": <1-10>, "flags": ["<issue1>", "<issue2>"] },
  "behavioral": { "score": <1-10>, "flags": ["<issue1>", "<issue2>"] }
}`;

export class RiskAnalyzer {
  private ollamaBaseUrl: string;
  private ollamaModel: string;
  private cloudConsent = false;
  private anthropicApiKey?: string;

  constructor(config?: {
    ollamaBaseUrl?: string;
    ollamaModel?: string;
    anthropicApiKey?: string;
  }) {
    this.ollamaBaseUrl = config?.ollamaBaseUrl ?? "http://localhost:11434";
    this.ollamaModel = config?.ollamaModel ?? "llama3.1:8b";
    this.anthropicApiKey = config?.anthropicApiKey;
  }

  setCloudConsent(consent: boolean): void {
    this.cloudConsent = consent;
  }

  async analyzeTranscript(
    sessionId: string,
    doctorId: string,
    segments: TranscriptSegment[],
    duration: number
  ): Promise<RiskAssessment> {
    const transcript = this.formatTranscript(segments);

    // Always run local analysis
    const localResult = await this.analyzeWithOllama(transcript);

    let finalResult = localResult;
    let source: RiskAssessment["analysisSource"] = "local";

    // If cloud consent is given and API key is available, also run cloud analysis
    if (this.cloudConsent && this.anthropicApiKey) {
      try {
        const deidentifiedTranscript = this.deidentifyTranscript(transcript);
        const cloudResult =
          await this.analyzeWithClaude(deidentifiedTranscript);
        finalResult = this.mergeResults(localResult, cloudResult);
        source = "hybrid";
      } catch (error) {
        console.error("Cloud analysis failed, using local only:", error);
      }
    }

    const overallScore =
      finalResult.communication.score * 0.35 +
      finalResult.clinical.score * 0.4 +
      finalResult.behavioral.score * 0.25;

    return {
      id: uuidv4(),
      sessionId,
      doctorId,
      timestamp: new Date().toISOString(),
      duration,
      communication: finalResult.communication,
      clinical: finalResult.clinical,
      behavioral: finalResult.behavioral,
      overallScore: Math.round(overallScore * 10) / 10,
      overallRisk:
        overallScore >= 7 ? "high" : overallScore >= 4 ? "medium" : "low",
      analysisSource: source,
    };
  }

  toDeidentifiedAssessment(
    assessment: RiskAssessment
  ): DeidentifiedAssessment {
    return {
      sessionId: assessment.sessionId,
      doctorId: assessment.doctorId,
      timestamp: assessment.timestamp,
      duration: assessment.duration,
      communication: assessment.communication,
      clinical: assessment.clinical,
      behavioral: assessment.behavioral,
      overallScore: assessment.overallScore,
      overallRisk: assessment.overallRisk,
      analysisSource: assessment.analysisSource,
    };
  }

  private formatTranscript(segments: TranscriptSegment[]): string {
    return segments
      .map((s) => {
        const speaker =
          s.speaker === "doctor"
            ? "Doctor"
            : s.speaker === "patient"
              ? "Patient"
              : "Unknown";
        return `[${speaker}]: ${s.text}`;
      })
      .join("\n");
  }

  private async analyzeWithOllama(
    transcript: string
  ): Promise<{
    communication: RiskCategoryScore;
    clinical: RiskCategoryScore;
    behavioral: RiskCategoryScore;
  }> {
    const prompt = RISK_ANALYSIS_PROMPT.replace("{transcript}", transcript);

    try {
      const response = await fetch(`${this.ollamaBaseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt,
          stream: false,
          format: "json",
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = (await response.json()) as OllamaResponse;
      const content = data.response ?? data.message?.content ?? "";
      return this.parseAnalysisResponse(content);
    } catch (error) {
      console.error("Ollama analysis failed:", error);
      return this.defaultScores();
    }
  }

  private async analyzeWithClaude(
    deidentifiedTranscript: string
  ): Promise<{
    communication: RiskCategoryScore;
    clinical: RiskCategoryScore;
    behavioral: RiskCategoryScore;
  }> {
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.anthropicApiKey });

    const prompt = RISK_ANALYSIS_PROMPT.replace(
      "{transcript}",
      deidentifiedTranscript
    );

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const content =
      response.content[0].type === "text" ? response.content[0].text : "";
    return this.parseAnalysisResponse(content);
  }

  private deidentifyTranscript(transcript: string): string {
    let deidentified = transcript;

    // Remove common name patterns (Dr. Lastname, Mr./Mrs./Ms. Lastname)
    deidentified = deidentified.replace(
      /\b(Dr|Mr|Mrs|Ms|Miss|Prof)\.\s+[A-Z][a-z]+\b/g,
      "$1. [REDACTED]"
    );

    // Remove phone numbers
    deidentified = deidentified.replace(
      /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
      "[PHONE]"
    );

    // Remove dates of birth patterns
    deidentified = deidentified.replace(
      /\b(born|DOB|date of birth)[:\s]+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi,
      "$1: [DOB]"
    );

    // Remove SSN patterns
    deidentified = deidentified.replace(
      /\b\d{3}-\d{2}-\d{4}\b/g,
      "[SSN]"
    );

    // Remove addresses (simplified pattern)
    deidentified = deidentified.replace(
      /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln)\b/gi,
      "[ADDRESS]"
    );

    // Remove medical record numbers (common patterns)
    deidentified = deidentified.replace(
      /\b(MRN|medical record|record number)[:\s#]+[\w-]+\b/gi,
      "$1: [MRN]"
    );

    return deidentified;
  }

  private mergeResults(
    local: {
      communication: RiskCategoryScore;
      clinical: RiskCategoryScore;
      behavioral: RiskCategoryScore;
    },
    cloud: {
      communication: RiskCategoryScore;
      clinical: RiskCategoryScore;
      behavioral: RiskCategoryScore;
    }
  ): {
    communication: RiskCategoryScore;
    clinical: RiskCategoryScore;
    behavioral: RiskCategoryScore;
  } {
    // Weight cloud analysis slightly higher (0.6) due to better nuance
    const mergeCategory = (
      l: RiskCategoryScore,
      c: RiskCategoryScore
    ): RiskCategoryScore => ({
      score: Math.round((l.score * 0.4 + c.score * 0.6) * 10) / 10,
      flags: [...new Set([...l.flags, ...c.flags])],
    });

    return {
      communication: mergeCategory(local.communication, cloud.communication),
      clinical: mergeCategory(local.clinical, cloud.clinical),
      behavioral: mergeCategory(local.behavioral, cloud.behavioral),
    };
  }

  private parseAnalysisResponse(content: string): {
    communication: RiskCategoryScore;
    clinical: RiskCategoryScore;
    behavioral: RiskCategoryScore;
  } {
    try {
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return this.defaultScores();

      const parsed = JSON.parse(jsonMatch[0]);

      const validateCategory = (cat: unknown): RiskCategoryScore => {
        if (
          typeof cat === "object" &&
          cat !== null &&
          "score" in cat &&
          "flags" in cat
        ) {
          const c = cat as { score: number; flags: string[] };
          return {
            score: Math.max(1, Math.min(10, Number(c.score) || 1)),
            flags: Array.isArray(c.flags)
              ? c.flags.filter((f: unknown) => typeof f === "string")
              : [],
          };
        }
        return { score: 1, flags: [] };
      };

      return {
        communication: validateCategory(parsed.communication),
        clinical: validateCategory(parsed.clinical),
        behavioral: validateCategory(parsed.behavioral),
      };
    } catch {
      return this.defaultScores();
    }
  }

  private defaultScores(): {
    communication: RiskCategoryScore;
    clinical: RiskCategoryScore;
    behavioral: RiskCategoryScore;
  } {
    return {
      communication: { score: 1, flags: ["Analysis unavailable"] },
      clinical: { score: 1, flags: ["Analysis unavailable"] },
      behavioral: { score: 1, flags: ["Analysis unavailable"] },
    };
  }
}
