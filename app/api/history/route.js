const { connectToDatabase } = require('@/lib/mongodb');
const { NextResponse } = require('next/server');

function extractTitleFromContent(content) {
  try {
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (
        trimmedLine.startsWith('🎯 TITLE:') ||
        trimmedLine.startsWith('🎯 TITEL:') ||
        trimmedLine.startsWith('🎙️ TITLE:') ||
        trimmedLine.startsWith('🎙️ TITEL:')
      ) {
        const title = trimmedLine.split(':')[1].trim();
        if (title) return title;
      }
    }
    const firstNonEmptyLine = lines.find((line) => line.trim().length > 0);
    if (firstNonEmptyLine) {
      return firstNonEmptyLine.trim().replace(/^[🎯🎙️]\s*/, '');
    }
  } catch (error) {
    console.error('Error extracting title:', error);
  }
  return 'Untitled Summary';
}

async function GET() {
  try {
    const { db } = await connectToDatabase();
    const summaries = await db
      .collection('summaries')
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const processedSummaries = summaries.map((summary) => ({
      id: summary._id.toString(), // Explicitly map _id to id
      videoId: summary.videoId,
      title: extractTitleFromContent(summary.content),
      content: summary.content,
      language: summary.language,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      mode: summary.mode,
      source: summary.source,
    }));

    return NextResponse.json({ summaries: processedSummaries });
  } catch (error) {
    console.error('Error fetching summaries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch summaries' },
      { status: 500 }
    );
  }
}

module.exports = { GET };