import { getRoles } from './roles.js';
import { getCli } from './cli.js';
import { runCli } from './cliRunner.js';
import { runApiChat } from './providers.js';
import { ROOT } from './brain.js';
import { projectPath } from './security.js';

export async function enhancePrompt({ raw, cliId, folder, brainContext }) {
  const roles = getRoles(folder);
  const enhancerConfig = roles.enhancer;

  let cliInstructions = '';
  if (cliId === 'codex') {
    cliInstructions = '\n- Target CLI is Codex: ensure any file references explicitly use file paths.';
  }

  const systemPrompt = `You are a Prompt Enhancer for an Agentic OS.
Your goal is to clarify vague user intent using the provided brain context.
Do NOT invent requirements not implied by the raw prompt.
Preserve the user's original meaning; never add scope.
Optimize for low output tokens: the enhanced prompt should be tighter and more information-dense than the original. Do not pad the prompt.
If the raw prompt is already clear and specific, return it unchanged.${cliInstructions}
Return ONLY a JSON object: { "enhanced": "...", "changed": boolean, "note": "..." }
The 'note' should be a one-line reason for the change, shown to the user.`;

  const augmented = `${systemPrompt}\n\nBrain Context:\n${brainContext}\n\nRaw Prompt:\n${raw}`;

  try {
    let outputText = '';
    
    if (enhancerConfig.kind === 'api' || enhancerConfig.kind === 'provider') {
      const controller = new AbortController();
      const result = await runApiChat(
        enhancerConfig.id,
        enhancerConfig.model,
        augmented,
        () => {}, // discard chunks
        controller.signal
      );
      outputText = result.output;
    } else {
      const cli = getCli(enhancerConfig.id);
      if (!cli || !cli.available) {
        return { enhanced: raw, changed: false, note: `Enhancer CLI ${enhancerConfig.id} is unavailable.` };
      }
      const cwd = projectPath(ROOT, folder);
      const result = await runCli(
        cli,
        enhancerConfig.model,
        enhancerConfig.effort,
        cwd,
        augmented
      );
      outputText = result.output;
    }

    // Try to parse out JSON object from markdown block if present
    let jsonRaw = outputText.trim();
    if (jsonRaw.includes('```json')) {
      const parts = jsonRaw.split('```json');
      if (parts.length > 1) {
        jsonRaw = parts[1].split('```')[0].trim();
      }
    } else if (jsonRaw.includes('```')) {
      const parts = jsonRaw.split('```');
      if (parts.length > 1) {
        jsonRaw = parts[1].split('```')[0].trim();
      }
    }

    // fallback brace extraction if there is garbage text around it
    if (!jsonRaw.startsWith('{')) {
      const startIdx = jsonRaw.indexOf('{');
      const endIdx = jsonRaw.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
         jsonRaw = jsonRaw.substring(startIdx, endIdx + 1);
      }
    }

    const parsed = JSON.parse(jsonRaw);
    
    if (parsed.changed) {
      return { enhanced: parsed.enhanced, changed: true, note: parsed.note };
    }
    return { enhanced: raw, changed: false, note: 'Already clear.' };
  } catch (e) {
    console.error('[enhancer] failed to run or parse', e.message);
    return { enhanced: raw, changed: false, note: 'Enhancement failed.' };
  }
}
