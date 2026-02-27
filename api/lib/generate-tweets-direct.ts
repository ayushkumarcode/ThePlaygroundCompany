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

export async function generateTweetsLogic(
  simulationId: string,
  ideaText: string,
  audience: string,
  tweetCount: number
) {
  console.log(`[${simulationId}] Starting tweet generation for ${tweetCount} tweets`);
  
  try {
    // Build the system prompt
    const systemPrompt = `You are simulating how ${audience} would react to a new idea on Twitter/X.

Generate ${tweetCount} realistic, diverse tweet reactions.

PERSONALITY DISTRIBUTION:
- Enthusiast (loves it, excited): 25%
- Skeptic (asks hard questions): 20%
- Technical expert (deep dive): 20%
- Encourager (positive but generic): 15%
- Confused person (misunderstood): 10%
- Contrarian (disagrees): 10%

LENGTH VARIETY:
- Short (1-10 words): 30%
- Medium (1-2 sentences): 50%
- Detailed (3-4 sentences): 20%

REALISM:
- Use casual Twitter language
- Include occasional typos
- Vary emoji usage
- Mix writing styles
- Keep under 280 characters
- Use realistic usernames

OUTPUT FORMAT (JSON):
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

    // Call OpenAI
    console.log(`[${simulationId}] Calling OpenAI API...`);
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
    if (!response) {
      throw new Error('Empty response from OpenAI');
    }

    const parsed = JSON.parse(response);
    const tweets = parsed.tweets || [];
    
    console.log(`[${simulationId}] Generated ${tweets.length} tweets`);

    // Save tweets to database
    const tweetsToSave = tweets.map((tweet: Tweet, index: number) => ({
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

    if (insertError) {
      console.error(`[${simulationId}] Error saving tweets:`, insertError);
      throw insertError;
    }

    // Update simulation status
    const { error: updateError } = await supabase
      .from('simulations')
      .update({ 
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', simulationId);

    if (updateError) {
      console.error(`[${simulationId}] Error updating status:`, updateError);
      throw updateError;
    }

    console.log(`[${simulationId}] ✅ Generation complete`);
    return tweets;

  } catch (error: any) {
    console.error(`[${simulationId}] Generation failed:`, error);
    
    // Mark as failed
    await supabase
      .from('simulations')
      .update({ status: 'failed' })
      .eq('id', simulationId);
    
    throw error;
  }
}
