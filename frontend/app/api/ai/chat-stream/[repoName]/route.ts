import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(
  request: NextRequest,
  { params }: { params: { repoName: string } }
) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  const { repoName } = params;

  // Get request body
  const body = await request.json();

  try {
    // Create fetch request to backend with streaming enabled
    const response = await fetch(`${apiUrl}/api/ai/chat-stream/${repoName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      return NextResponse.json({ error: 'Backend request failed' }, { status: response.status });
    }

    // Return the stream directly - Edge runtime handles it properly
    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Origin',
    },
  });
}
