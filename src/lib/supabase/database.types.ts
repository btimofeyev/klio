export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      adjustment_actions: {
        Row: {
          action_type: string
          after_state: Json
          assignment_id: string | null
          before_state: Json
          created_at: string
          family_id: string
          id: string
          position: number
          proposal_id: string
          status: string
        }
        Insert: {
          action_type: string
          after_state?: Json
          assignment_id?: string | null
          before_state?: Json
          created_at?: string
          family_id: string
          id?: string
          position?: number
          proposal_id: string
          status?: string
        }
        Update: {
          action_type?: string
          after_state?: Json
          assignment_id?: string | null
          before_state?: Json
          created_at?: string
          family_id?: string
          id?: string
          position?: number
          proposal_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "adjustment_actions_assignment_id_family_id_fkey"
            columns: ["assignment_id", "family_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "adjustment_actions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adjustment_actions_proposal_id_family_id_fkey"
            columns: ["proposal_id", "family_id"]
            isOneToOne: false
            referencedRelation: "adjustment_proposals"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      adjustment_proposals: {
        Row: {
          agent_turn_id: string | null
          applied_at: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          family_id: string
          id: string
          reason: string
          snapshot_version: number
          status: string
          student_id: string
          summary: string
          updated_at: string
          week_start: string
        }
        Insert: {
          agent_turn_id?: string | null
          applied_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          family_id: string
          id?: string
          reason: string
          snapshot_version: number
          status?: string
          student_id: string
          summary: string
          updated_at?: string
          week_start: string
        }
        Update: {
          agent_turn_id?: string | null
          applied_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          family_id?: string
          id?: string
          reason?: string
          snapshot_version?: number
          status?: string
          student_id?: string
          summary?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "adjustment_proposals_agent_turn_id_family_id_fkey"
            columns: ["agent_turn_id", "family_id"]
            isOneToOne: false
            referencedRelation: "agent_turns"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "adjustment_proposals_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adjustment_proposals_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_events: {
        Row: {
          created_at: string
          family_id: string
          id: number
          kind: string
          payload: Json
          sequence: number
          turn_id: string
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: never
          kind: string
          payload?: Json
          sequence: number
          turn_id: string
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: never
          kind?: string
          payload?: Json
          sequence?: number
          turn_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_events_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_turn_id_family_id_fkey"
            columns: ["turn_id", "family_id"]
            isOneToOne: false
            referencedRelation: "agent_turns"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      agent_job_actions: {
        Row: {
          agent_run_id: string | null
          artifact_id: string | null
          attempt_count: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          family_id: string
          id: string
          intent: string
          job_id: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          agent_run_id?: string | null
          artifact_id?: string | null
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          family_id: string
          id?: string
          intent: string
          job_id: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          agent_run_id?: string | null
          artifact_id?: string | null
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          family_id?: string
          id?: string
          intent?: string
          job_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_job_actions_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_job_actions_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_job_actions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_job_actions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "agent_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_job_evidence: {
        Row: {
          evidence_id: string
          family_id: string
          job_id: string
        }
        Insert: {
          evidence_id: string
          family_id: string
          job_id: string
        }
        Update: {
          evidence_id?: string
          family_id?: string
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_job_evidence_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_job_evidence_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_job_evidence_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "agent_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_jobs: {
        Row: {
          attempt_count: number
          completed_actions: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          failed_actions: number
          family_id: string
          id: string
          last_heartbeat_at: string | null
          requested_by: string
          started_at: string | null
          status: string
          student_id: string
          total_actions: number
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          completed_actions?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          failed_actions?: number
          family_id: string
          id?: string
          last_heartbeat_at?: string | null
          requested_by: string
          started_at?: string | null
          status?: string
          student_id: string
          total_actions: number
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          completed_actions?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          failed_actions?: number
          family_id?: string
          id?: string
          last_heartbeat_at?: string | null
          requested_by?: string
          started_at?: string | null
          status?: string
          student_id?: string
          total_actions?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_jobs_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_run_evidence: {
        Row: {
          agent_run_id: string
          evidence_id: string
          family_id: string
        }
        Insert: {
          agent_run_id: string
          evidence_id: string
          family_id: string
        }
        Update: {
          agent_run_id?: string
          evidence_id?: string
          family_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_run_evidence_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_run_evidence_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_run_evidence_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent_thread_id: string | null
          agent_turn_id: string | null
          completed_at: string | null
          created_at: string
          error_code: string | null
          family_id: string
          id: string
          input_summary: Json
          intent: string
          job_action_id: string | null
          model: string | null
          output_summary: Json | null
          requested_by: string
          started_at: string | null
          status: string
          tool_trace: Json
        }
        Insert: {
          agent_thread_id?: string | null
          agent_turn_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          family_id: string
          id?: string
          input_summary?: Json
          intent: string
          job_action_id?: string | null
          model?: string | null
          output_summary?: Json | null
          requested_by: string
          started_at?: string | null
          status?: string
          tool_trace?: Json
        }
        Update: {
          agent_thread_id?: string | null
          agent_turn_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          family_id?: string
          id?: string
          input_summary?: Json
          intent?: string
          job_action_id?: string | null
          model?: string | null
          output_summary?: Json | null
          requested_by?: string
          started_at?: string | null
          status?: string
          tool_trace?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_agent_thread_family_fkey"
            columns: ["agent_thread_id", "family_id"]
            isOneToOne: false
            referencedRelation: "agent_threads"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "agent_runs_agent_turn_family_fkey"
            columns: ["agent_turn_id", "family_id"]
            isOneToOne: false
            referencedRelation: "agent_turns"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "agent_runs_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_job_action_id_fkey"
            columns: ["job_action_id"]
            isOneToOne: true
            referencedRelation: "agent_job_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_threads: {
        Row: {
          agent_kind: string
          created_at: string
          family_id: string
          generation: number
          id: string
          last_turn_at: string | null
          provider: string
          provider_thread_id: string | null
          runtime_version: string | null
          status: string
          turn_count: number
          updated_at: string
        }
        Insert: {
          agent_kind?: string
          created_at?: string
          family_id: string
          generation?: number
          id?: string
          last_turn_at?: string | null
          provider: string
          provider_thread_id?: string | null
          runtime_version?: string | null
          status?: string
          turn_count?: number
          updated_at?: string
        }
        Update: {
          agent_kind?: string
          created_at?: string
          family_id?: string
          generation?: number
          id?: string
          last_turn_at?: string | null
          provider?: string
          provider_thread_id?: string | null
          runtime_version?: string | null
          status?: string
          turn_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_threads_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tool_calls: {
        Row: {
          approval_request_id: string | null
          arguments_redacted: Json
          completed_at: string | null
          created_at: string
          family_id: string
          id: string
          idempotency_key: string
          provider_item_id: string | null
          result_summary: Json | null
          risk: string
          snapshot_version: number
          started_at: string | null
          status: string
          tool_name: string
          turn_id: string
        }
        Insert: {
          approval_request_id?: string | null
          arguments_redacted?: Json
          completed_at?: string | null
          created_at?: string
          family_id: string
          id?: string
          idempotency_key: string
          provider_item_id?: string | null
          result_summary?: Json | null
          risk: string
          snapshot_version: number
          started_at?: string | null
          status?: string
          tool_name: string
          turn_id: string
        }
        Update: {
          approval_request_id?: string | null
          arguments_redacted?: Json
          completed_at?: string | null
          created_at?: string
          family_id?: string
          id?: string
          idempotency_key?: string
          provider_item_id?: string | null
          result_summary?: Json | null
          risk?: string
          snapshot_version?: number
          started_at?: string | null
          status?: string
          tool_name?: string
          turn_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tool_calls_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tool_calls_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tool_calls_turn_id_family_id_fkey"
            columns: ["turn_id", "family_id"]
            isOneToOne: false
            referencedRelation: "agent_turns"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      agent_turns: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          current_snapshot_version: number
          error_code: string | null
          family_id: string
          goal: string
          id: string
          idempotency_key: string
          initial_snapshot_version: number
          last_heartbeat_at: string | null
          outcome: string | null
          provider_turn_id: string | null
          public_result: Json | null
          requested_by: string | null
          snapshot_hash: string
          snapshot_summary: Json
          source_evidence_id: string | null
          started_at: string | null
          status: string
          thread_id: string
          trigger: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          current_snapshot_version: number
          error_code?: string | null
          family_id: string
          goal: string
          id?: string
          idempotency_key: string
          initial_snapshot_version: number
          last_heartbeat_at?: string | null
          outcome?: string | null
          provider_turn_id?: string | null
          public_result?: Json | null
          requested_by?: string | null
          snapshot_hash: string
          snapshot_summary?: Json
          source_evidence_id?: string | null
          started_at?: string | null
          status?: string
          thread_id: string
          trigger: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          current_snapshot_version?: number
          error_code?: string | null
          family_id?: string
          goal?: string
          id?: string
          idempotency_key?: string
          initial_snapshot_version?: number
          last_heartbeat_at?: string | null
          outcome?: string | null
          provider_turn_id?: string | null
          public_result?: Json | null
          requested_by?: string | null
          snapshot_hash?: string
          snapshot_summary?: Json
          source_evidence_id?: string | null
          started_at?: string | null
          status?: string
          thread_id?: string
          trigger?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_turns_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_turns_source_evidence_id_fkey"
            columns: ["source_evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_turns_thread_id_family_id_fkey"
            columns: ["thread_id", "family_id"]
            isOneToOne: false
            referencedRelation: "agent_threads"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          entity_id: string
          entity_type: string
          family_id: string
          id: string
          requested_by_run: string | null
          status: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          entity_id: string
          entity_type: string
          family_id: string
          id?: string
          requested_by_run?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          entity_id?: string
          entity_type?: string
          family_id?: string
          id?: string
          requested_by_run?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_requested_by_run_fkey"
            columns: ["requested_by_run"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      artifact_sources: {
        Row: {
          artifact_id: string
          evidence_id: string
          family_id: string
          note: string | null
        }
        Insert: {
          artifact_id: string
          evidence_id: string
          family_id: string
          note?: string | null
        }
        Update: {
          artifact_id?: string
          evidence_id?: string
          family_id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "artifact_sources_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifact_sources_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifact_sources_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      artifacts: {
        Row: {
          agent_run_id: string | null
          content: Json
          created_at: string
          created_by: string
          family_id: string
          id: string
          rationale: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          student_id: string | null
          summary: string | null
          supersedes_id: string | null
          title: string
          type: string
          updated_at: string
          version: number
        }
        Insert: {
          agent_run_id?: string | null
          content: Json
          created_at?: string
          created_by: string
          family_id: string
          id?: string
          rationale?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          student_id?: string | null
          summary?: string | null
          supersedes_id?: string | null
          title: string
          type: string
          updated_at?: string
          version?: number
        }
        Update: {
          agent_run_id?: string | null
          content?: Json
          created_at?: string
          created_by?: string
          family_id?: string
          id?: string
          rationale?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          student_id?: string | null
          summary?: string | null
          supersedes_id?: string | null
          title?: string
          type?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_reviews: {
        Row: {
          agent_turn_id: string | null
          assignment_id: string
          created_at: string
          draft_feedback: string | null
          draft_score: number | null
          family_id: string
          feedback: string | null
          id: string
          mastery_signals: Json
          reviewed_at: string | null
          reviewed_by: string | null
          rubric: Json
          score: number | null
          score_label: string | null
          status: string
          student_id: string
          submission_id: string
          uncertainty_flags: Json
          updated_at: string
        }
        Insert: {
          agent_turn_id?: string | null
          assignment_id: string
          created_at?: string
          draft_feedback?: string | null
          draft_score?: number | null
          family_id: string
          feedback?: string | null
          id?: string
          mastery_signals?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          rubric?: Json
          score?: number | null
          score_label?: string | null
          status?: string
          student_id: string
          submission_id: string
          uncertainty_flags?: Json
          updated_at?: string
        }
        Update: {
          agent_turn_id?: string | null
          assignment_id?: string
          created_at?: string
          draft_feedback?: string | null
          draft_score?: number | null
          family_id?: string
          feedback?: string | null
          id?: string
          mastery_signals?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          rubric?: Json
          score?: number | null
          score_label?: string | null
          status?: string
          student_id?: string
          submission_id?: string
          uncertainty_flags?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_reviews_agent_turn_id_family_id_fkey"
            columns: ["agent_turn_id", "family_id"]
            isOneToOne: false
            referencedRelation: "agent_turns"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "assignment_reviews_assignment_id_family_id_fkey"
            columns: ["assignment_id", "family_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "assignment_reviews_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_reviews_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_reviews_submission_id_family_id_fkey"
            columns: ["submission_id", "family_id"]
            isOneToOne: false
            referencedRelation: "assignment_submissions"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      assignment_submission_evidence: {
        Row: {
          created_at: string
          evidence_id: string
          family_id: string
          submission_id: string
        }
        Insert: {
          created_at?: string
          evidence_id: string
          family_id: string
          submission_id: string
        }
        Update: {
          created_at?: string
          evidence_id?: string
          family_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_submission_evidence_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_submission_evidence_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_submission_evidence_submission_id_family_id_fkey"
            columns: ["submission_id", "family_id"]
            isOneToOne: false
            referencedRelation: "assignment_submissions"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      assignment_submissions: {
        Row: {
          assignment_id: string
          created_at: string
          family_id: string
          id: string
          note: string | null
          status: string
          student_id: string
          submitted_at: string
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          assignment_id: string
          created_at?: string
          family_id: string
          id?: string
          note?: string | null
          status?: string
          student_id: string
          submitted_at?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          created_at?: string
          family_id?: string
          id?: string
          note?: string | null
          status?: string
          student_id?: string
          submitted_at?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_submissions_assignment_id_family_id_fkey"
            columns: ["assignment_id", "family_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "assignment_submissions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_submissions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          created_by_type: string
          curriculum_unit_id: string | null
          due_at: string | null
          estimated_minutes: number | null
          family_id: string
          id: string
          instructions: string | null
          scheduled_date: string | null
          scheduled_time: string | null
          sequence_number: number | null
          skipped_at: string | null
          source_kind: string
          status: string
          student_id: string
          subject: string
          submitted_at: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_type?: string
          curriculum_unit_id?: string | null
          due_at?: string | null
          estimated_minutes?: number | null
          family_id: string
          id?: string
          instructions?: string | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          sequence_number?: number | null
          skipped_at?: string | null
          source_kind?: string
          status?: string
          student_id: string
          subject: string
          submitted_at?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_type?: string
          curriculum_unit_id?: string | null
          due_at?: string | null
          estimated_minutes?: number | null
          family_id?: string
          id?: string
          instructions?: string | null
          scheduled_date?: string | null
          scheduled_time?: string | null
          sequence_number?: number | null
          skipped_at?: string | null
          source_kind?: string
          status?: string
          student_id?: string
          subject?: string
          submitted_at?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "assignments_curriculum_unit_id_family_id_fkey"
            columns: ["curriculum_unit_id", "family_id"]
            isOneToOne: false
            referencedRelation: "curriculum_units"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "assignments_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          created_at: string
          entity_id: string | null
          entity_type: string
          family_id: string
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          family_id: string
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          family_id?: string
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_type: string
          description: string | null
          family_id: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_type?: string
          description?: string | null
          family_id: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_type?: string
          description?: string | null
          family_id?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      curriculum_units: {
        Row: {
          created_at: string
          created_by: string
          curriculum_url: string | null
          default_minutes: number
          family_id: string
          id: string
          next_sequence_number: number
          schedule_rule: Json
          sequence_label: string
          status: string
          student_id: string
          subject: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          curriculum_url?: string | null
          default_minutes?: number
          family_id: string
          id?: string
          next_sequence_number?: number
          schedule_rule?: Json
          sequence_label?: string
          status?: string
          student_id: string
          subject: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          curriculum_url?: string | null
          default_minutes?: number
          family_id?: string
          id?: string
          next_sequence_number?: number
          schedule_rule?: Json
          sequence_label?: string
          status?: string
          student_id?: string
          subject?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "curriculum_units_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curriculum_units_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_categories: {
        Row: {
          agent_tool_call_id: string | null
          assigned_by: string
          category_id: string
          confidence: number | null
          created_at: string
          document_type: string | null
          evidence_id: string
          family_id: string
          tags: string[]
        }
        Insert: {
          agent_tool_call_id?: string | null
          assigned_by?: string
          category_id: string
          confidence?: number | null
          created_at?: string
          document_type?: string | null
          evidence_id: string
          family_id: string
          tags?: string[]
        }
        Update: {
          agent_tool_call_id?: string | null
          assigned_by?: string
          category_id?: string
          confidence?: number | null
          created_at?: string
          document_type?: string | null
          evidence_id?: string
          family_id?: string
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "evidence_categories_agent_tool_call_family_fkey"
            columns: ["agent_tool_call_id", "family_id"]
            isOneToOne: false
            referencedRelation: "agent_tool_calls"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "evidence_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_categories_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_categories_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_items: {
        Row: {
          capture_route: string
          capture_submission_id: string | null
          created_at: string
          created_by: string
          error_message: string | null
          extracted_text: string | null
          extraction: Json | null
          family_id: string
          file_size: number | null
          id: string
          kind: string
          mime_type: string | null
          processing_status: string
          provenance: Json
          raw_text: string | null
          source_at: string
          storage_path: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          capture_route?: string
          capture_submission_id?: string | null
          created_at?: string
          created_by: string
          error_message?: string | null
          extracted_text?: string | null
          extraction?: Json | null
          family_id: string
          file_size?: number | null
          id?: string
          kind: string
          mime_type?: string | null
          processing_status?: string
          provenance?: Json
          raw_text?: string | null
          source_at?: string
          storage_path?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          capture_route?: string
          capture_submission_id?: string | null
          created_at?: string
          created_by?: string
          error_message?: string | null
          extracted_text?: string | null
          extraction?: Json | null
          family_id?: string
          file_size?: number | null
          id?: string
          kind?: string
          mime_type?: string | null
          processing_status?: string
          provenance?: Json
          raw_text?: string | null
          source_at?: string
          storage_path?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_items_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_students: {
        Row: {
          created_at: string
          evidence_id: string
          family_id: string
          student_id: string
        }
        Insert: {
          created_at?: string
          evidence_id: string
          family_id: string
          student_id: string
        }
        Update: {
          created_at?: string
          evidence_id?: string
          family_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_students_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_students_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_students_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          agent_context_version: number
          available_days: Json
          created_at: string
          created_by: string
          id: string
          name: string
          timezone: string
          updated_at: string
          weekly_minutes: number | null
        }
        Insert: {
          agent_context_version?: number
          available_days?: Json
          created_at?: string
          created_by: string
          id?: string
          name: string
          timezone?: string
          updated_at?: string
          weekly_minutes?: number | null
        }
        Update: {
          agent_context_version?: number
          available_days?: Json
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          timezone?: string
          updated_at?: string
          weekly_minutes?: number | null
        }
        Relationships: []
      }
      family_members: {
        Row: {
          created_at: string
          family_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          family_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          family_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          confirmed_at: string | null
          created_at: string
          created_by: string
          family_id: string
          id: string
          mapping: Json | null
          status: string
          storage_path: string
          validation_results: Json | null
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          created_by: string
          family_id: string
          id?: string
          mapping?: Json | null
          status?: string
          storage_path: string
          validation_results?: Json | null
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          created_by?: string
          family_id?: string
          id?: string
          mapping?: Json | null
          status?: string
          storage_path?: string
          validation_results?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "imports_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      observation_evidence: {
        Row: {
          evidence_id: string
          family_id: string
          observation_id: string
        }
        Insert: {
          evidence_id: string
          family_id: string
          observation_id: string
        }
        Update: {
          evidence_id?: string
          family_id?: string
          observation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "observation_evidence_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observation_evidence_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observation_evidence_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "skill_observations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_corrections: {
        Row: {
          created_at: string
          created_by: string
          cues: string[]
          evidence_excerpt: string | null
          evidence_id: string | null
          evidence_title: string | null
          family_id: string
          from_category_name: string | null
          id: string
          to_category_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          cues?: string[]
          evidence_excerpt?: string | null
          evidence_id?: string | null
          evidence_title?: string | null
          family_id: string
          from_category_name?: string | null
          id?: string
          to_category_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          cues?: string[]
          evidence_excerpt?: string | null
          evidence_id?: string | null
          evidence_title?: string | null
          family_id?: string
          from_category_name?: string | null
          id?: string
          to_category_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_corrections_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_corrections_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_corrections_to_category_id_fkey"
            columns: ["to_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_profiles: {
        Row: {
          created_at: string
          display_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      practice_results: {
        Row: {
          answers: Json
          created_at: string
          evidence_id: string | null
          family_id: string
          id: string
          mastery_met: boolean
          practice_session_id: string
          score: number
          student_id: string
        }
        Insert: {
          answers: Json
          created_at?: string
          evidence_id?: string | null
          family_id: string
          id?: string
          mastery_met: boolean
          practice_session_id: string
          score: number
          student_id: string
        }
        Update: {
          answers?: Json
          created_at?: string
          evidence_id?: string | null
          family_id?: string
          id?: string
          mastery_met?: boolean
          practice_session_id?: string
          score?: number
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_results_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_results_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_results_practice_session_id_fkey"
            columns: ["practice_session_id"]
            isOneToOne: false
            referencedRelation: "practice_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_results_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_sessions: {
        Row: {
          artifact_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          family_id: string
          id: string
          launched_at: string | null
          skill_observation_id: string | null
          spec: Json
          status: string
          student_id: string
        }
        Insert: {
          artifact_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          family_id: string
          id?: string
          launched_at?: string | null
          skill_observation_id?: string | null
          spec: Json
          status?: string
          student_id: string
        }
        Update: {
          artifact_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          family_id?: string
          id?: string
          launched_at?: string | null
          skill_observation_id?: string | null
          spec?: Json
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "practice_sessions_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_sessions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_sessions_skill_observation_id_fkey"
            columns: ["skill_observation_id"]
            isOneToOne: false
            referencedRelation: "skill_observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practice_sessions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      question_message_sources: {
        Row: {
          family_id: string
          message_id: string
          source_id: string
          source_type: string
          title: string
        }
        Insert: {
          family_id: string
          message_id: string
          source_id: string
          source_type: string
          title: string
        }
        Update: {
          family_id?: string
          message_id?: string
          source_id?: string
          source_type?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_message_sources_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_message_sources_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "question_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      question_messages: {
        Row: {
          agent_turn_id: string | null
          confidence: string | null
          content: string
          created_at: string
          created_by: string | null
          family_id: string
          id: string
          role: string
          thread_id: string
        }
        Insert: {
          agent_turn_id?: string | null
          confidence?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          family_id: string
          id?: string
          role: string
          thread_id: string
        }
        Update: {
          agent_turn_id?: string | null
          confidence?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          family_id?: string
          id?: string
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_messages_agent_turn_family_fkey"
            columns: ["agent_turn_id", "family_id"]
            isOneToOne: false
            referencedRelation: "agent_turns"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "question_messages_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "question_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      question_threads: {
        Row: {
          agent_thread_id: string | null
          created_at: string
          created_by: string
          family_id: string
          id: string
          student_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          agent_thread_id?: string | null
          created_at?: string
          created_by: string
          family_id: string
          id?: string
          student_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          agent_thread_id?: string | null
          created_at?: string
          created_by?: string
          family_id?: string
          id?: string
          student_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_threads_agent_thread_family_fkey"
            columns: ["agent_thread_id", "family_id"]
            isOneToOne: false
            referencedRelation: "agent_threads"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "question_threads_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_threads_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          agent_run_id: string | null
          agent_tool_call_id: string | null
          completed_at: string | null
          confidence: number | null
          created_at: string
          created_by: string | null
          created_by_type: string
          due_at: string | null
          family_id: string
          id: string
          notes: string | null
          rationale: string | null
          source_evidence_id: string | null
          status: string
          student_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          agent_run_id?: string | null
          agent_tool_call_id?: string | null
          completed_at?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          created_by_type: string
          due_at?: string | null
          family_id: string
          id?: string
          notes?: string | null
          rationale?: string | null
          source_evidence_id?: string | null
          status?: string
          student_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          agent_run_id?: string | null
          agent_tool_call_id?: string | null
          completed_at?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          created_by_type?: string
          due_at?: string | null
          family_id?: string
          id?: string
          notes?: string | null
          rationale?: string | null
          source_evidence_id?: string | null
          status?: string
          student_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_agent_tool_call_family_fkey"
            columns: ["agent_tool_call_id", "family_id"]
            isOneToOne: false
            referencedRelation: "agent_tool_calls"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "reminders_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_source_evidence_id_fkey"
            columns: ["source_evidence_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_observations: {
        Row: {
          approval_status: string
          author_type: string
          authored_by: string | null
          confidence: number | null
          created_at: string
          family_id: string
          id: string
          rationale: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          skill_key: string
          skill_label: string
          status: string
          student_id: string
          subject: string
          uncertainty_flags: Json
          updated_at: string
        }
        Insert: {
          approval_status?: string
          author_type: string
          authored_by?: string | null
          confidence?: number | null
          created_at?: string
          family_id: string
          id?: string
          rationale: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          skill_key: string
          skill_label: string
          status: string
          student_id: string
          subject: string
          uncertainty_flags?: Json
          updated_at?: string
        }
        Update: {
          approval_status?: string
          author_type?: string
          authored_by?: string | null
          confidence?: number | null
          created_at?: string
          family_id?: string
          id?: string
          rationale?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          skill_key?: string
          skill_label?: string
          status?: string
          student_id?: string
          subject?: string
          uncertainty_flags?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_observations_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skill_observations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_subjects: {
        Row: {
          course_name: string | null
          created_at: string
          created_by: string
          family_id: string
          id: string
          name: string
          position: number
          status: string
          student_id: string
          updated_at: string
          weekly_frequency: number
        }
        Insert: {
          course_name?: string | null
          created_at?: string
          created_by: string
          family_id: string
          id?: string
          name: string
          position?: number
          status?: string
          student_id: string
          updated_at?: string
          weekly_frequency?: number
        }
        Update: {
          course_name?: string | null
          created_at?: string
          created_by?: string
          family_id?: string
          id?: string
          name?: string
          position?: number
          status?: string
          student_id?: string
          updated_at?: string
          weekly_frequency?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_subjects_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_subjects_student_id_family_id_fkey"
            columns: ["student_id", "family_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "family_id"]
          },
        ]
      }
      students: {
        Row: {
          active: boolean
          birth_year: number | null
          created_at: string
          daily_capacity_minutes: number
          display_name: string
          family_id: string
          grade_band: string | null
          id: string
          learning_preferences: string | null
          schedule_preferences: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          birth_year?: number | null
          created_at?: string
          daily_capacity_minutes?: number
          display_name: string
          family_id: string
          grade_band?: string | null
          id?: string
          learning_preferences?: string | null
          schedule_preferences?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          birth_year?: number | null
          created_at?: string
          daily_capacity_minutes?: number
          display_name?: string
          family_id?: string
          grade_band?: string | null
          id?: string
          learning_preferences?: string | null
          schedule_preferences?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          family_id: string
          price_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          family_id: string
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          family_id?: string
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: true
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_plan_items: {
        Row: {
          artifact_id: string | null
          assignment_id: string | null
          completed_at: string | null
          created_at: string
          curriculum_url: string | null
          description: string | null
          estimated_minutes: number | null
          family_id: string
          id: string
          position: number
          rescheduled_count: number
          scheduled_date: string | null
          scheduled_time: string | null
          skill_key: string | null
          source_kind: string
          student_id: string | null
          subject: string | null
          title: string
          updated_at: string
        }
        Insert: {
          artifact_id?: string | null
          assignment_id?: string | null
          completed_at?: string | null
          created_at?: string
          curriculum_url?: string | null
          description?: string | null
          estimated_minutes?: number | null
          family_id: string
          id?: string
          position?: number
          rescheduled_count?: number
          scheduled_date?: string | null
          scheduled_time?: string | null
          skill_key?: string | null
          source_kind?: string
          student_id?: string | null
          subject?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          artifact_id?: string | null
          assignment_id?: string | null
          completed_at?: string | null
          created_at?: string
          curriculum_url?: string | null
          description?: string | null
          estimated_minutes?: number | null
          family_id?: string
          id?: string
          position?: number
          rescheduled_count?: number
          scheduled_date?: string | null
          scheduled_time?: string | null
          skill_key?: string | null
          source_kind?: string
          student_id?: string | null
          subject?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_plan_items_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_plan_items_assignment_family_fkey"
            columns: ["assignment_id", "family_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id", "family_id"]
          },
          {
            foreignKeyName: "weekly_plan_items_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_plan_items_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_agent_workspace_tool: {
        Args: {
          p_arguments: Json
          p_arguments_redacted?: Json
          p_idempotency_key: string
          p_tool_name: string
          p_turn_id: string
        }
        Returns: Json
      }
      apply_agent_workspace_tool_v1: {
        Args: {
          p_arguments: Json
          p_arguments_redacted?: Json
          p_idempotency_key: string
          p_tool_name: string
          p_turn_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

