import test from 'node:test';
import assert from 'node:assert/strict';
import { jevApprovalError } from '../src/services/jev-approval-policy.js';
import { contentHash, type DraftReview } from '../src/services/support-ai.js';
import { jevEnabledForBrand } from '../src/services/jev-store.js';
const actions = [{ type: 'send_reply', params: { reply_text: 'Verified reply' } }];
const review = { mode: 'active', status: 'passed', draft_hash: contentHash('Verified reply') } as DraftReview;
test('threshold execution rejects a missing, failed, shadow or edited assessment', () => {
  for (const current of [undefined, {...review,status:'unavailable'}, {...review,status:'needs_review'}, {...review,mode:'shadow'}, {...review,draft_hash:contentHash('Old reply')}]) {
    assert.ok(jevApprovalError({ actions, review: current as DraftReview | undefined, required: true }));
  }
  assert.equal(jevApprovalError({ actions, review, required: true }), null);
  assert.equal(jevApprovalError({ actions: [{type:'add_tags',params:{}}], required: true }), null);
});
test('brand rollout never enables the evaluator for another brand or missing scope', () => {
  const env = {JEV_MODE:'active',TYPESAFE_API_KEY:'test',JEV_BRAND_IDS:'warm-id'};
  assert.equal(jevEnabledForBrand('warm-id',env),true);
  assert.equal(jevEnabledForBrand('outlight-id',env),false);
  assert.equal(jevEnabledForBrand(undefined,env),false);
  assert.equal(jevEnabledForBrand('warm-id',{...env,JEV_BRAND_IDS:''}),false);
});
