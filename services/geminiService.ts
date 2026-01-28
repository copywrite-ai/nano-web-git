
import { GoogleGenAI } from "@google/genai";

export async function explainCode(code: string, fileName: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Explain the following code in ${fileName}. Keep it concise but insightful.\n\n\`\`\`\n${code}\n\`\`\``,
  });

  const response = await model;
  return response.text || "No explanation available.";
}

export async function summarizeRepo(fileList: string[]): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Analyze this list of files in a repository and tell me what this project is likely about:\n\n${fileList.join('\n')}`,
  });

  const response = await model;
  return response.text || "Could not summarize repository.";
}
