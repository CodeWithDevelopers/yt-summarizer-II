import { NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { extractVideoId, createSummaryPrompt } from '@/lib/youtube';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Groq } from 'groq-sdk';
import { getOpenAIClient } from '@/lib/openai';
import ytdl from 'ytdl-core';
import { connectToDatabase } from '@/lib/mongodb';

// Logger
const logger = {
  info: (message, data) => {
    console.log(`[INFO] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  error: (message, error) => {
    console.error(`[ERROR] ${message}`, {
      message: error?.message,
      status: error?.status,
      stack: error?.stack,
      cause: error?.cause,
      details: error?.details,
      response: error?.response,
    });
  },
  debug: (message, data) => {
    console.debug(`[DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
};

// Model names
const MODEL_NAMES = {
  gemini: 'Google Gemini',
  groq: 'Groq',
  gpt4: 'GPT-4',
};

// Check API key availability
function checkApiKeyAvailability() {
  return {
    gemini: !!process.env.GEMINI_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
    gpt4: !!process.env.OPENAI_API_KEY,
  };
}

// Clean model outputs
function cleanModelOutput(text) {
  return text
    .replace(/^(Okay|Here'?s?( is)?|Let me|I will|I'll|I can|I would|I am going to|Allow me to|Sure|Of course|Certainly|Alright)[^]*?,\s*/i, '')
    .replace(/^(Here'?s?( is)?|I'?ll?|Let me|I will|I can|I would|I am going to|Allow me to|Sure|Of course|Certainly)[^]*?(summary|translate|breakdown|analysis).*?:\s*/i, '')
    .replace(/^(Based on|According to).*?,\s*/i, '')
    .replace(/^I understand.*?[.!]\s*/i, '')
    .replace(/^(Now|First|Let's),?\s*/i, '')
    .replace(/^(Here are|The following is|This is|Below is).*?:\s*/i, '')
    .replace(/^(I'll provide|Let me break|I'll break|I'll help|I've structured).*?:\s*/i, '')
    .replace(/^(As requested|Following your|In response to).*?:\s*/i, '')
    .replace(/^(Okay|Hier( ist)?|Lass mich|Ich werde|Ich kann|Ich würde|Ich möchte|Erlauben Sie mir|Sicher|Natürlich|Gewiss|In Ordnung)[^]*?,\s*/i, '')
    .replace(/^(Hier( ist)?|Ich werde|Lass mich|Ich kann|Ich würde|Ich möchte)[^]*?(Zusammenfassung|Übersetzung|Analyse).*?:\s*/i, '')
    .replace(/^(Basierend auf|Laut|Gemäß).*?,\s*/i, '')
    .replace(/^Ich verstehe.*?[.!]\s*/i, '')
    .replace(/^(Jetzt|Zunächst|Lass uns),?\s*/i, '')
    .replace(/^(Hier sind|Folgendes|Dies ist|Im Folgenden).*?:\s*/i, '')
    .replace(/^(Ich werde|Lass mich|Ich helfe|Ich habe strukturiert).*?:\s*/i, '')
    .replace(/^(Wie gewünscht|Entsprechend Ihrer|Als Antwort auf).*?:\s*/i, '')
    .replace(/^[^:\n🎯🎙️#*\-•]+:\s*/gm, '')
    .replace(/^(?![#*\-•🎯️])[\s\d]+\.\s*/gm, '')
    .trim();
}

// AI model configuration
const AI_MODELS = {
  gemini: {
    name: 'gemini',
    async generateContent(prompt) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error(`${MODEL_NAMES.gemini} API key is not configured.`);
      }
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return cleanModelOutput(response.text());
    },
  },
  groq: {
    name: 'groq',
    model: 'llama3-70b-8192',
    async generateContent(prompt) {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new Error(`${MODEL_NAMES.groq} API key is not configured.`);
      }
      const groq = new Groq({ apiKey });
      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'You are a direct and concise summarizer. Respond only with the summary, without any prefixes or meta-commentary. Keep all markdown formatting intact.',
          },
          { role: 'user', content: prompt },
        ],
        model: this.model,
        temperature: 0.7,
        max_tokens: 2048,
      });
      return cleanModelOutput(completion.choices[0]?.message?.content || '');
    },
  },
  gpt4: {
    name: 'gpt4',
    model: 'gpt-4o-mini',
    async generateContent(prompt) {
      const openai = getOpenAIClient();
      if (!openai) {
        throw new Error(`${MODEL_NAMES.gpt4} API key is not configured.`);
      }
      const completion = await openai.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'You are a direct and concise summarizer. Respond only with the summary, without any prefixes or meta-commentary. Keep all markdown formatting intact.',
          },
          { role: 'user', content: prompt },
        ],
        model: this.model,
        temperature: 0.7,
        max_tokens: 2048,
      });
      return cleanModelOutput(completion.choices[0]?.message?.content || '');
    },
  },
};

async function splitTranscriptIntoChunks(transcript, chunkSize = 7000, overlap = 1000) {
  const words = transcript.split(' ');
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const word of words) {
    if (currentLength + word.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
      const overlapWords = currentChunk.slice(-Math.floor(overlap / 10));
      currentChunk = [...overlapWords];
      currentLength = overlapWords.join(' ').length;
    }
    currentChunk.push(word);
    currentLength += word.length + 1;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }

  return chunks;
}

async function getTranscript(videoId) {
  try {
    logger.info(`Attempting to fetch YouTube transcript for video ${videoId}`);
    const transcriptList = await YoutubeTranscript.fetchTranscript(videoId);

    const firstFewLines = transcriptList.slice(0, 5).map(item => item.text).join(' ');
    let title = firstFewLines.split('.')[0].trim();

    if (title.length > 100) {
      title = title.substring(0, 97) + '...';
    }
    if (title.length < 10) {
      title = `YouTube Video Summary`;
    }

    logger.info('Successfully retrieved YouTube transcript');
    logger.debug('Transcript details:', {
      title,
      length: transcriptList.length,
      firstLine: transcriptList[0]?.text,
    });

    return {
      transcript: transcriptList.map(item => item.text).join(' '),
      source: 'youtube',
      title,
    };
  } catch (error) {
    logger.info('YouTube transcript not available, falling back to video info...');
    const videoInfo = await ytdl.getInfo(videoId);
    const title = videoInfo.videoDetails.title;

    logger.info('Video info retrieved successfully:', {
      title,
      duration: videoInfo.videoDetails.lengthSeconds,
      author: videoInfo.videoDetails.author.name,
    });

    throw new Error('Transcript not available and Whisper fallback is disabled.');
  }
}

export async function GET() {
  return NextResponse.json(checkApiKeyAvailability());
}

export async function POST(request) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const writeProgress = async (data) => {
    await writer.write(encoder.encode(JSON.stringify(data) + '\n'));
  };

  (async () => {
    try {
      const { url, language, mode, aiModel = 'gemini' } = await request.json();
      const videoId = extractVideoId(url);

      logger.info('Processing video request', { videoId, language, mode, aiModel });

      if (!AI_MODELS[aiModel]) {
        throw new Error(`Invalid AI model selected. Please choose from: ${Object.values(MODEL_NAMES).join(', ')}`);
      }

      const selectedModel = AI_MODELS[aiModel];
      logger.info(`Using ${MODEL_NAMES[aiModel]} model for generation...`);

      const { db } = await connectToDatabase();
      const existingSummary = await db.collection('summaries').findOne({ videoId, language });

      if (existingSummary) {
        await writeProgress({
          type: 'complete',
          summary: existingSummary.content,
          source: existingSummary.source || 'youtube',
          status: 'completed',
        });
        await writer.close();
        return;
      }

      await writeProgress({
        type: 'progress',
        currentChunk: 0,
        totalChunks: 1,
        stage: 'analyzing',
        message: 'Fetching video transcript...',
      });

      const { transcript, source, title } = await getTranscript(videoId);
      const chunks = await splitTranscriptIntoChunks(transcript);
      const totalChunks = chunks.length;
      const intermediateSummaries = [];

      for (let i = 0; i < chunks.length; i++) {
        await writeProgress({
          type: 'progress',
          currentChunk: i + 1,
          totalChunks,
          stage: 'processing',
          message: `Processing section ${i + 1} of ${totalChunks}...`,
        });

        const prompt = `Create a detailed summary of section ${i + 1} in ${language}.
        Maintain all important information, arguments, and connections.
        Pay special attention to:
        - Main topics and arguments
        - Important details and examples
        - Connections with other mentioned topics
        - Key statements and conclusions

        Text: ${chunks[i]}`;

        const text = await selectedModel.generateContent(prompt);
        intermediateSummaries.push(text);
      }

      await writeProgress({
        type: 'progress',
        currentChunk: totalChunks,
        totalChunks,
        stage: 'finalizing',
        message: 'Creating final summary...',
      });

      const combinedSummary = intermediateSummaries.join('\n\n=== Next Section ===\n\n');
      const finalPrompt = createSummaryPrompt(combinedSummary, language, mode);
      const summary = await selectedModel.generateContent(finalPrompt);

      if (!summary) {
        throw new Error('No summary content generated');
      }

      await writeProgress({
        type: 'progress',
        currentChunk: totalChunks,
        totalChunks,
        stage: 'saving',
        message: 'Saving summary to history...',
      });

      try {
        const summaryDoc = {
          videoId,
          title,
          content: summary,
          language,
          mode,
          source: source || 'youtube',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const existing = await db.collection('summaries').findOne({ videoId, language });

        let savedSummary;
        if (existing) {
          savedSummary = await db.collection('summaries').findOneAndUpdate(
            { videoId, language },
            { $set: { content: summary, mode, source: source || 'youtube', updatedAt: new Date() } },
            { returnDocument: 'after' }
          );
          savedSummary = savedSummary.value;
        } else {
          const result = await db.collection('summaries').insertOne(summaryDoc);
          savedSummary = { ...summaryDoc, _id: result.insertedId };
        }

        logger.info('Summary saved to database:', { videoId, language, summaryId: savedSummary._id.toString() });

        await writeProgress({
          type: 'complete',
          summary: savedSummary.content,
          source: savedSummary.source || 'youtube',
          status: 'completed',
        });
      } catch (dbError) {
        logger.error('Failed to save to database:', dbError);
        await writeProgress({
          type: 'complete',
          summary,
          source: source || 'youtube',
          status: 'completed',
          warning: 'Failed to save to history',
        });
      }
    } catch (error) {
      logger.error('Error processing video:', { error, stack: error?.stack, cause: error?.cause });
      await writeProgress({
        type: 'error',
        error: error?.message || 'Failed to process video',
        details: error?.toString() || 'Unknown error',
      });
    } finally {
      await writer.close().catch(closeError => logger.error('Failed to close writer:', closeError));
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}