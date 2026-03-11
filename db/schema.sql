-- ═══════════════════════════════════════════════
-- PHANTOMOS PLATFORM — SCHEMA COMPLETO
-- ═══════════════════════════════════════════════

-- TENANTS (empresas/usuários)
CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(100) UNIQUE NOT NULL,
  email       VARCHAR(255) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,
  plan        VARCHAR(50) DEFAULT 'free',
  plan_expires_at TIMESTAMP,
  executions_used  INT DEFAULT 0,
  executions_limit INT DEFAULT 50,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- SESSÕES
CREATE TABLE IF NOT EXISTS sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  token      VARCHAR(500) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- APPS INSTALADOS POR TENANT
CREATE TABLE IF NOT EXISTS tenant_apps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  app_id     VARCHAR(100) NOT NULL,
  installed_at TIMESTAMP DEFAULT NOW(),
  config     JSONB DEFAULT '{}',
  UNIQUE(tenant_id, app_id)
);

-- MARKETPLACE — APPS PUBLICADOS
CREATE TABLE IF NOT EXISTS marketplace_apps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID REFERENCES tenants(id),
  slug         VARCHAR(100) UNIQUE NOT NULL,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  long_description TEXT,
  category     VARCHAR(100),
  icon         VARCHAR(10),
  price        DECIMAL(10,2) DEFAULT 0,
  price_type   VARCHAR(20) DEFAULT 'free',
  status       VARCHAR(20) DEFAULT 'pending',
  installs     INT DEFAULT 0,
  rating       DECIMAL(3,2) DEFAULT 0,
  version      VARCHAR(20) DEFAULT '1.0.0',
  code_url     TEXT,
  manifest     JSONB DEFAULT '{}',
  screenshots  JSONB DEFAULT '[]',
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

-- REVIEWS DO MARKETPLACE
CREATE TABLE IF NOT EXISTS marketplace_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      UUID REFERENCES marketplace_apps(id) ON DELETE CASCADE,
  tenant_id   UUID REFERENCES tenants(id),
  rating      INT CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(app_id, tenant_id)
);

-- SOCIAL STUDIO — CONTAS CONECTADAS
CREATE TABLE IF NOT EXISTS social_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  platform    VARCHAR(50) NOT NULL,
  username    VARCHAR(255),
  account_id  VARCHAR(255),
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  status      VARCHAR(20) DEFAULT 'active',
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMP DEFAULT NOW()
);

-- SOCIAL STUDIO — POSTS AGENDADOS
CREATE TABLE IF NOT EXISTS social_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  account_id  UUID REFERENCES social_accounts(id),
  content     TEXT,
  media_urls  JSONB DEFAULT '[]',
  platforms   JSONB DEFAULT '[]',
  status      VARCHAR(30) DEFAULT 'draft',
  scheduled_at TIMESTAMP,
  published_at TIMESTAMP,
  ai_generated BOOLEAN DEFAULT FALSE,
  pillar      VARCHAR(100),
  metrics     JSONB DEFAULT '{}',
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ARTE IA — ARTES GERADAS
CREATE TABLE IF NOT EXISTS generated_arts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  prompt      TEXT,
  html_source TEXT,
  image_url   TEXT,
  pillar      VARCHAR(100),
  niche       VARCHAR(100),
  status      VARCHAR(20) DEFAULT 'pending',
  approved    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- WHATSAPP CRM — CONVERSAS
CREATE TABLE IF NOT EXISTS wa_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  contact_phone VARCHAR(30) NOT NULL,
  contact_name  VARCHAR(255),
  status      VARCHAR(30) DEFAULT 'open',
  assigned_to VARCHAR(255),
  last_message TEXT,
  last_message_at TIMESTAMP,
  tags        JSONB DEFAULT '[]',
  created_at  TIMESTAMP DEFAULT NOW()
);

-- WHATSAPP CRM — MENSAGENS
CREATE TABLE IF NOT EXISTS wa_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES wa_conversations(id) ON DELETE CASCADE,
  tenant_id     UUID REFERENCES tenants(id),
  direction     VARCHAR(10),
  content       TEXT,
  media_url     TEXT,
  ai_generated  BOOLEAN DEFAULT FALSE,
  read          BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- AGENDA — SERVIÇOS
CREATE TABLE IF NOT EXISTS agenda_services (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  duration    INT,
  price       DECIMAL(10,2),
  description TEXT,
  active      BOOLEAN DEFAULT TRUE
);

-- AGENDA — AGENDAMENTOS
CREATE TABLE IF NOT EXISTS agenda_bookings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  service_id  UUID REFERENCES agenda_services(id),
  client_name VARCHAR(255),
  client_phone VARCHAR(30),
  client_email VARCHAR(255),
  scheduled_at TIMESTAMP NOT NULL,
  status      VARCHAR(30) DEFAULT 'confirmed',
  notes       TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- AUTOMATION ENGINE — FLUXOS
CREATE TABLE IF NOT EXISTS automations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  trigger     JSONB NOT NULL,
  steps       JSONB DEFAULT '[]',
  active      BOOLEAN DEFAULT TRUE,
  runs        INT DEFAULT 0,
  last_run    TIMESTAMP,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- AUTOMATION ENGINE — EXECUÇÕES
CREATE TABLE IF NOT EXISTS automation_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID REFERENCES automations(id) ON DELETE CASCADE,
  tenant_id     UUID REFERENCES tenants(id),
  status        VARCHAR(20),
  log           JSONB DEFAULT '[]',
  started_at    TIMESTAMP DEFAULT NOW(),
  finished_at   TIMESTAMP
);

-- BOLETO MANAGER — LOTES
CREATE TABLE IF NOT EXISTS boleto_batches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(255),
  total       INT DEFAULT 0,
  processed   INT DEFAULT 0,
  failed      INT DEFAULT 0,
  status      VARCHAR(20) DEFAULT 'pending',
  created_at  TIMESTAMP DEFAULT NOW()
);

-- EXECUÇÕES DO SISTEMA (para billing)
CREATE TABLE IF NOT EXISTS usage_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  app_id      VARCHAR(100),
  action      VARCHAR(100),
  cost        INT DEFAULT 1,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ÍNDICES
CREATE INDEX IF NOT EXISTS idx_tenant_apps_tenant ON tenant_apps(tenant_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_tenant ON social_posts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
CREATE INDEX IF NOT EXISTS idx_wa_conversations_tenant ON wa_conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_automations_tenant ON automations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_usage_log_tenant ON usage_log(tenant_id);
