import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface Tweet {
  author: string;
  text: string;
  sentiment: 'praise' | 'neutral' | 'worry';
}

export async function generateTweetsForSimulation(
  simulationId: string,
  ideaText: string,
  audience: string,
  tweetCount: number
) {
  console.log(`[${simulationId}] 🚀 Starting generation for ${tweetCount} tweets`);
  console.log(`[${simulationId}] Idea: "${ideaText.substring(0, 50)}..."`);

  try {
    // Generate tweets in one pass
    const tweets = await generateTweets(ideaText, audience, tweetCount);
    
    console.log(`[${simulationId}] ✅ Generated ${tweets.length} tweets`);

    // Format for database
    const tweetsToInsert = tweets.map((tweet, index) => ({
      simulation_id: simulationId,
      author_name: tweet.author,
      tweet_text: tweet.text,
      sentiment: tweet.sentiment,
      is_reply: false,
      reply_to_id: null,
      order_index: index,
    }));

    // Insert to database
    const { error: insertError } = await supabase
      .from('generated_tweets')
      .insert(tweetsToInsert);

    if (insertError) {
      console.error(`[${simulationId}] ❌ Insert error:`, insertError);
      throw insertError;
    }

    // Update status to completed
    const { error: updateError } = await supabase
      .from('simulations')
      .update({ 
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', simulationId);

    if (updateError) {
      console.error(`[${simulationId}] ❌ Update error:`, updateError);
      throw updateError;
    }

    console.log(`[${simulationId}] ✅ Completed successfully`);
    return { success: true, tweetCount: tweets.length };

  } catch (error: any) {
    console.error(`[${simulationId}] ❌ Generation failed:`, error);
    
    // Mark as failed
    try {
      await supabase
        .from('simulations')
        .update({ status: 'failed' })
        .eq('id', simulationId);
      console.log(`[${simulationId}] Marked as failed`);
    } catch (err) {
      console.error(`[${simulationId}] Failed to update status:`, err);
    }
    
    throw error;
  }
}

async function generateTweets(
  ideaText: string,
  audience: string,
  count: number
): Promise<Tweet[]> {
  console.log(`[generateTweets] Starting with count=${count}, audience=${audience}`);
  
  // Check if OpenAI key exists
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY is not set!');
    throw new Error('OpenAI API key not configured');
  }
  
  console.log('✅ OpenAI key found, length:', process.env.OPENAI_API_KEY.length);

  const systemPrompt = `You are simulating realistic Twitter/X reactions to an idea.

AUDIENCE: ${audience}
Generate exactly ${count} unique tweet responses.

PERSONALITY DISTRIBUTION:
- Hype person (enthusiastic, emojis): 15%
- Skeptic (asks hard questions): 20%
- Technical expert (specific concerns): 20%
- Encourager (positive but vague): 15%
- Confused (misunderstood the idea): 10%
- Contrarian (disagrees on principle): 10%
- Thoughtful (constructive feedback): 10%

LENGTH DISTRIBUTION:
- Short (1-10 words): 30%
- Medium (1-2 sentences): 50%
- Detailed (3-4 sentences): 20%

REALISM RULES:
- Mix of casual and professional language
- Occasional typos (but not every tweet)
- Vary emoji usage - some tweets have them, most don't
- Some users didn't read carefully
- Include specific technical questions when relevant
- Mix writing styles
- Realistic usernames (@tech_guru, @startup_guy, etc.)
- Keep under 280 characters

SENTIMENT:
- "praise": Positive, supportive, excited
- "neutral": Questions, curious, observing
- "worry": Concerns, skepticism, criticism

OUTPUT FORMAT (MUST BE VALID JSON):
{
  "tweets": [
    {
      "author": "@realistic_username",
      "text": "tweet content here",
      "sentiment": "praise" | "neutral" | "worry"
    }
  ]
}`;

  const userPrompt = `Simulate Twitter reactions to this idea:\n\n"${ideaText}"\n\nGenerate exactly ${count} diverse, realistic tweets.`;

  console.log('📝 Calling OpenAI API...');
  
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.9,
      response_format: { type: 'json_object' },
      max_tokens: 2000, // Add explicit limit
      timeout: 30000 // 30 second timeout
    });

    console.log('✅ OpenAI API responded successfully');

    const response = completion.choices[0].message.content;
    if (!response) {
      console.error('❌ Empty response from OpenAI');
      throw new Error('Empty response from OpenAI');
    }

    console.log('📝 Parsing JSON response...');
    const parsed = JSON.parse(response);
    const tweets = parsed.tweets || [];
    console.log(`✅ Parsed ${tweets.length} tweets`);
    
    return tweets;
  } catch (error: any) {
    console.error('❌ OpenAI API Error:', error.message);
    console.error('Full error:', error);
    throw error;
  }
}

