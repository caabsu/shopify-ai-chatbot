
-- Add brand_id to conversations
ALTER TABLE conversations ADD COLUMN brand_id uuid REFERENCES brands(id);
UPDATE conversations SET brand_id = '883e4a28-9f2e-4850-a527-29f297d8b6f8';
ALTER TABLE conversations ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE conversations ALTER COLUMN brand_id SET DEFAULT '883e4a28-9f2e-4850-a527-29f297d8b6f8';
CREATE INDEX idx_conversations_brand_id ON conversations(brand_id);

-- Add brand_id to messages
ALTER TABLE messages ADD COLUMN brand_id uuid REFERENCES brands(id);
UPDATE messages SET brand_id = '883e4a28-9f2e-4850-a527-29f297d8b6f8';
ALTER TABLE messages ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE messages ALTER COLUMN brand_id SET DEFAULT '883e4a28-9f2e-4850-a527-29f297d8b6f8';
CREATE INDEX idx_messages_brand_id ON messages(brand_id);

-- Add brand_id to knowledge_documents
ALTER TABLE knowledge_documents ADD COLUMN brand_id uuid REFERENCES brands(id);
UPDATE knowledge_documents SET brand_id = '883e4a28-9f2e-4850-a527-29f297d8b6f8';
ALTER TABLE knowledge_documents ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE knowledge_documents ALTER COLUMN brand_id SET DEFAULT '883e4a28-9f2e-4850-a527-29f297d8b6f8';
CREATE INDEX idx_knowledge_documents_brand_id ON knowledge_documents(brand_id);

-- Add brand_id to ai_config, replace unique(key) with unique(brand_id, key)
ALTER TABLE ai_config ADD COLUMN brand_id uuid REFERENCES brands(id);
UPDATE ai_config SET brand_id = '883e4a28-9f2e-4850-a527-29f297d8b6f8';
ALTER TABLE ai_config ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE ai_config ALTER COLUMN brand_id SET DEFAULT '883e4a28-9f2e-4850-a527-29f297d8b6f8';
ALTER TABLE ai_config DROP CONSTRAINT IF EXISTS ai_config_key_key;
ALTER TABLE ai_config ADD CONSTRAINT ai_config_brand_key_unique UNIQUE (brand_id, key);

-- Add brand_id to return_requests
ALTER TABLE return_requests ADD COLUMN brand_id uuid REFERENCES brands(id);
UPDATE return_requests SET brand_id = '883e4a28-9f2e-4850-a527-29f297d8b6f8' WHERE brand_id IS NULL;
ALTER TABLE return_requests ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE return_requests ALTER COLUMN brand_id SET DEFAULT '883e4a28-9f2e-4850-a527-29f297d8b6f8';
CREATE INDEX idx_return_requests_brand_id ON return_requests(brand_id);
;
