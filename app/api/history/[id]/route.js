const { connectToDatabase } = require('@/lib/mongodb');
const { NextResponse } = require('next/server');
const { ObjectId } = require('mongodb');

function extractTitleFromContent(content) {
  try {
    const lines = content.split('\n');
    // Look for title in different formats
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
    // Fallback: Use first non-empty line if no title marker found
    const firstNonEmptyLine = lines.find((line) => line.trim().length > 0);
    if (firstNonEmptyLine) {
      return firstNonEmptyLine.trim().replace(/^[🎯🎙️]\s*/, '');
    }
  } catch (error) {
    console.error('Error extracting title:', error);
  }
  return 'Untitled Summary';
}

async function GET(request, { params }) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Summary ID is required' },
        { status: 400 }
      );
    }

    const { db } = await connectToDatabase();
    const summary = await db
      .collection('summaries')
      .findOne({ _id: new ObjectId(id) });

    if (!summary) {
      return NextResponse.json(
        { error: 'Summary not found' },
        { status: 404 }
      );
    }

    const extractedTitle = extractTitleFromContent(summary.content);

    return NextResponse.json({
      summary: {
        ...summary,
        _id: summary._id.toString(), // Convert MongoDB ObjectId to string
        title: extractedTitle,
        youtubeTitle: extractedTitle,
        youtubeThumbnail: null,
        youtubeDescription: '',
      },
    });
  } catch (error) {
    console.error('Error fetching summary:', error);
    return NextResponse.json(
      { error: 'Failed to fetch summary' },
      { status: 500 }
    );
  }
}

module.exports = { GET };