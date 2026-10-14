export interface DashboardStats {
  total_connections: number;
  active_automations: number;
  pending_approvals: number;
  total_publications: number;
  failed_executions: number;
  total_knowledge_docs: number;
}

export interface ConnectionProfile {
  id: number;
  name: string;
  db_type: string;
  host: string;
  port: number;
  database: string;
  username: string;
  is_active: boolean;
  last_tested_at?: string;
  last_status: string;
  created_at: string;
  updated_at: string;
}

export interface SchemaColumn {
  name: string;
  data_type: string;
  nullable: boolean;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  default_value?: string;
  max_length?: number;
  enum_values?: string[];
  is_unique: boolean;
}

export interface SchemaRelationship {
  foreign_key?: string;
  constrained_column?: string;
  referenced_table: string;
  referenced_column: string;
}

export interface SchemaTable {
  name: string;
  table_name?: string;
  category: "RECOMMENDED" | "REVIEW_REQUIRED" | "RESTRICTED" | "READ_ONLY" | "ALLOWLISTED";
  eligibility_tier?: "RECOMMENDED" | "REVIEW_REQUIRED" | "RESTRICTED" | "READ_ONLY";
  recommendation_score?: number;
  evidence?: string[];
  is_sensitive?: boolean;
  eligible_for_automation?: boolean;
  restriction_reason?: string;
  approx_rows?: number;
  row_count_estimate?: number;
  columns: SchemaColumn[];
  relationships: SchemaRelationship[];
  ai_suggestion?: {
    purpose?: string;
    concept?: string;
    user_notes?: string;
    is_user_verified?: boolean;
  };
}

export interface SchemaResponse {
  connection_id: number;
  database?: string;
  database_name?: string;
  tables: SchemaTable[];
  snapshot_version?: number;
  schema_diff?: {
    has_changes: boolean;
    added_tables: string[];
    removed_tables: string[];
    modified_tables: Array<{
      table: string;
      added_columns: string[];
      removed_columns: string[];
    }>;
  };
  scanned_at?: string;
}

export interface FieldMapping {
  column: string;
  source: "AI_GENERATED" | "FIXED_VALUE" | "RELATIONSHIP_LOOKUP" | "RUNTIME_VALUE" | "USER_INPUT";
  value?: any;
  rule?: string;
  lookup_table?: string;
  lookup_column?: string;
  lookup_value?: any;
  relation_config?: {
    referenced_table: string;
    lookup_field: string;
    creation_policy: "CREATE_IF_MISSING" | "REUSE_EXISTING_ONLY";
    value?: any;
  };
}

export interface AIConfig {
  provider: string;
  model: string;
  topic: string;
  tone: string;
  target_audience?: string;
  word_count?: number;
  document_ids: number[];
  custom_instructions?: string;
}

export interface ScheduleConfig {
  frequency: string;
  start_date?: string;
  timezone: string;
  generation_time: string;
  publication_time: string;
}

export interface ApprovalPolicy {
  require_approval: boolean;
  reviewer_email: string;
  timeout_action: string;
  max_regenerations: number;
}

export interface Automation {
  id: number;
  name: string;
  connection_id: number;
  connection?: {
    id: number;
    name: string;
    host: string;
    database_name: string;
  };
  target_table: string;
  operation_mode?: string;
  operation?: string;
  mode?: "AI_GENERATED" | "MANUAL";
  field_mappings: FieldMapping[];
  ai_config?: AIConfig;
  schedule_config?: ScheduleConfig;
  approval_policy?: ApprovalPolicy;
  status: "ACTIVE" | "PAUSED" | "DISABLED";
  is_active?: boolean;
  version?: number;
  executions_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ContentVersion {
  id: number;
  execution_id: number;
  automation_id: number;
  version_number: number;
  payload: Record<string, any>;
  status: string;
  rejection_feedback?: string;
  created_at: string;
}

export interface TimelineEvent {
  timestamp: string;
  stage: string;
  message: string;
  metadata?: any;
}

export interface RelationResolution {
  table: string;
  action: string;
  lookup: any;
  resolved_id: any;
  details: string;
}

export interface Execution {
  id: number;
  automation_id: number;
  automation_name?: string;
  automation?: {
    id: number;
    name: string;
    target_table: string;
  };
  status: string;
  mode?: string;
  trigger_type?: string;
  idempotency_key: string;
  scheduled_generation_time?: string;
  scheduled_publication_time?: string;
  publication_time?: string;
  published_at?: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  target_record_id?: string;
  regeneration_count?: number;
  created_at: string;
  versions?: ContentVersion[];
  current_version?: ContentVersion;
  timeline_events?: TimelineEvent[];
  relation_resolutions?: RelationResolution[];
}

export interface KnowledgeDocument {
  id: number;
  title: string;
  filename: string;
  file_type: string;
  file_size_bytes: number;
  chunk_count: number;
  status: string;
  created_at: string;
}

export interface AIProviderInfo {
  provider_id: string;
  name: string;
  is_available: boolean;
  is_local: boolean;
  requires_api_key: boolean;
  is_configured: boolean;
  available_models?: string[];
  models?: string[];
  current_model: string;
  status_message: string;
}

export interface ProposedAutomationPlan {
  success: boolean;
  name: string;
  target_table: string;
  operation_mode: string;
  topic: string;
  tone: string;
  category_name?: string;
  field_mappings: Array<{
    field_name: string;
    mapping_type: string;
    source_field?: string;
    fixed_value?: any;
    relation_config?: {
      referenced_table: string;
      lookup_field: string;
      creation_policy: "CREATE_IF_MISSING" | "REUSE_EXISTING_ONLY";
      value?: any;
    };
  }>;
  schedule_type: string;
  generation_time: string;
  publication_time: string;
  timezone: string;
  requires_approval: boolean;
  timeout_policy: string;
  explanation: string;
  error?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
