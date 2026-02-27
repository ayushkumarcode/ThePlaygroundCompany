import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// TEMPORARY: Clerk JWT verification disabled for MVP
// TODO: Fix @clerk/backend import and JWT verification

// Initialize Supabase with service role key (server-side only)
const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const openaiKey = process.env.OPENAI_API_KEY;
console.log('OpenAI key status:', openaiKey ? `Present (${openaiKey.length} chars)` : 'MISSING');

const openai = new OpenAI({
  apiKey: openaiKey,
});

// Inline tweet generation function
async function generateTweetsLogic(
  simulationId: string,
  ideaText: string,
  audience: string,
  tweetCount: number
) {
  console.log(`[${simulationId}] Starting tweet generation for ${tweetCount} tweets`);
  
  try {
    const systemPrompt = `You are simulating how ${audience} would react to a new idea on Twitter/X.
Generate ${tweetCount} realistic, diverse tweet reactions.

PERSONALITY MIX:
- Enthusiast (loves it): 25%
- Skeptic (questions): 20%
- Technical expert: 20%
- Encourager: 15%
- Confused: 10%
- Contrarian: 10%

OUTPUT JSON FORMAT:
{
  "tweets": [
    {
      "author": "@username",
      "text": "tweet content",
      "sentiment": "praise" | "neutral" | "worry"
    }
  ]
}`;

    const userPrompt = `Generate Twitter reactions to: "${ideaText}"`;

    console.log(`[${simulationId}] Calling OpenAI...`);
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.9,
      response_format: { type: 'json_object' },
      max_tokens: 2000
    }, {
      timeout: 30000
    });

    const response = completion.choices[0].message.content;
    if (!response) throw new Error('Empty response');

    const parsed = JSON.parse(response);
    const tweets = parsed.tweets || [];
    
    console.log(`[${simulationId}] Generated ${tweets.length} tweets`);

    // Save tweets
    const tweetsToSave = tweets.map((tweet: any, index: number) => ({
      id: `${simulationId}-${index}`,
      simulation_id: simulationId,
      author: tweet.author,
      content: tweet.text,
      sentiment: tweet.sentiment,
      is_reply: false,
      parent_tweet_id: null,
      created_at: new Date().toISOString(),
      engagement_score: Math.floor(Math.random() * 100)
    }));

    const { error: insertError } = await supabase
      .from('generated_tweets')
      .insert(tweetsToSave);

    if (insertError) throw insertError;

    // Update status
    const { error: updateError } = await supabase
      .from('simulations')
      .update({ 
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', simulationId);

    if (updateError) throw updateError;

    console.log(`[${simulationId}] ✅ Generation complete`);
    return tweets;

  } catch (error: any) {
    console.error(`[${simulationId}] Failed:`, error);
    console.error(`[${simulationId}] Error details:`, {
      message: error.message,
      status: error.status,
      code: error.code,
      type: error.type
    });
    await supabase
      .from('simulations')
      .update({ status: 'failed' })
      .eq('id', simulationId);
    throw error;
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ideaText, audience, tweetCount } = req.body;

    // Validate inputs
    if (!ideaText || !audience || !tweetCount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (tweetCount < 10 || tweetCount > 100) {
      return res.status(400).json({ error: 'Tweet count must be between 10 and 100' });
    }

    // TEMPORARY: Simplified auth for MVP testing
    // TODO: Fix Clerk JWT verification with proper @clerk/backend API
    const authHeader = req.headers.authorization;
    
    // For now, use a fixed test user ID
    const clerkUserId = 'test_user_mvp';
    const userEmail = 'test@example.com';

    // Ensure user exists in Supabase database
    let { data: user, error: userFetchError } = await supabase
      .from('users')
      .select('id, simulation_count')
      .eq('clerk_id', clerkUserId)
      .single();

    if (userFetchError && userFetchError.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine (we'll create the user)
      console.error('Error fetching user:', userFetchError);
      throw userFetchError;
    }

    // Create user if doesn't exist
    if (!user) {
      const { data: newUser, error: createUserError } = await supabase
        .from('users')
        .insert({
          clerk_id: clerkUserId,
          email: userEmail || 'unknown@email.com',
          simulation_count: 0
        })
        .select('id, simulation_count')
        .single();

      if (createUserError) {
        console.error('Error creating user:', createUserError);
        throw createUserError;
      }

      user = newUser;
      console.log(`Created new user: ${clerkUserId}`);
    }

    // Create simulation record
    const { data: simulation, error: simError } = await supabase
      .from('simulations')
      .insert({
        user_id: user!.id,
        idea_text: ideaText,
        audience: audience,
        tweet_count: tweetCount,
        status: 'generating'
      })
      .select()
      .single();

    if (simError) {
      console.error('Error creating simulation:', simError);
      throw simError;
    }

    console.log(`Created simulation ${simulation.id} for user ${clerkUserId}`);

    // Increment user's simulation count
    await supabase
      .from('users')
      .update({ simulation_count: (user!.simulation_count || 0) + 1 })
      .eq('id', user!.id);

    // Trigger LLM generation directly
    console.log(`[${simulation.id}] 🚀 Triggering LLM generation...`);
    
    // Try to generate tweets synchronously for debugging
    try {
      await generateTweetsLogic(
        simulation.id,
        ideaText,
        audience,
        tweetCount
      );
      console.log(`[${simulation.id}] ✅ Generation completed successfully`);
    } catch (err) {
      console.error(`[${simulation.id}] ❌ Generation failed:`, err);
      // Don't fail the request, just log the error
    }

    res.status(200).json({
      simulationId: simulation.id,
      status: 'generating',
      message: 'Simulation created successfully'
    });

  } catch (error: any) {
    console.error('Error creating simulation:', error);
    res.status(500).json({ 
      error: 'Failed to create simulation',
      details: error.message 
    });
  }
}
