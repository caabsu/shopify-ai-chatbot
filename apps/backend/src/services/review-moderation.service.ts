import type { Review, ReviewSettings, ModerationResult } from '../types/index.js';

const PROFANITY_LIST = [
  'fuck', 'shit', 'damn', 'ass', 'bitch', 'bastard', 'crap', 'dick',
  'piss', 'cunt', 'cock', 'whore', 'slut', 'nigger', 'faggot', 'retard',
  'bullshit', 'motherfucker', 'asshole', 'douchebag',
];

function containsProfanity(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const word of PROFANITY_LIST) {
    // Match whole word boundaries to reduce false positives
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(lower)) {
      found.push(word);
    }
  }
  return found;
}

function hasExcessiveCaps(text: string): boolean {
  // Only check strings with enough letters to be meaningful
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 10) return false;
  const upperCount = letters.replace(/[^A-Z]/g, '').length;
  return (upperCount / letters.length) > 0.7;
}

function isBodyTooShort(body: string): boolean {
  return body.trim().length < 5;
}

export function evaluateReview(
  review: Pick<Review, 'rating' | 'body' | 'title' | 'verified_purchase'>,
  settings: Pick<ReviewSettings, 'auto_publish' | 'auto_publish_min_rating' | 'auto_publish_verified_only' | 'profanity_filter'>,
): ModerationResult {
  const reasons: string[] = [];

  // Check profanity filter
  if (settings.profanity_filter) {
    const bodyProfanity = containsProfanity(review.body);
    const titleProfanity = review.title ? containsProfanity(review.title) : [];
    const allProfanity = [...new Set([...bodyProfanity, ...titleProfanity])];

    if (allProfanity.length > 0) {
      reasons.push(`Contains profanity: ${allProfanity.join(', ')}`);
      return { action: 'reject', reasons };
    }
  }

  // Check body length
  if (isBodyTooShort(review.body)) {
    reasons.push('Review body is too short (less than 5 characters)');
    return { action: 'reject', reasons };
  }

  // Check excessive caps
  if (hasExcessiveCaps(review.body)) {
    reasons.push('Review body contains excessive uppercase characters (>70%)');
    return { action: 'pending', reasons };
  }

  if (review.title && hasExcessiveCaps(review.title)) {
    reasons.push('Review title contains excessive uppercase characters (>70%)');
    return { action: 'pending', reasons };
  }

  // Check auto-publish eligibility
  if (!settings.auto_publish) {
    reasons.push('Auto-publish is disabled');
    return { action: 'pending', reasons };
  }

  if (review.rating < settings.auto_publish_min_rating) {
    reasons.push(`Rating ${review.rating} is below auto-publish minimum of ${settings.auto_publish_min_rating}`);
    return { action: 'pending', reasons };
  }

  if (settings.auto_publish_verified_only && !review.verified_purchase) {
    reasons.push('Auto-publish requires verified purchase');
    return { action: 'pending', reasons };
  }

  // All checks passed — auto publish
  reasons.push('Passed all moderation checks');
  return { action: 'publish', reasons };
}
