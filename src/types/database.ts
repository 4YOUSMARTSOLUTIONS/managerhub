export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agendas: {
        Row: { id: string; tenant_id: string; unit_id: string | null; name: string; description: string | null; owner_id: string; responsible_id: string; can_responsible_edit: boolean; active: boolean; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; unit_id?: string | null; name: string; description?: string | null; owner_id: string; responsible_id: string; can_responsible_edit?: boolean; active?: boolean; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; unit_id?: string | null; name?: string; description?: string | null; owner_id?: string; responsible_id?: string; can_responsible_edit?: boolean; active?: boolean; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      agenda_tasks: {
        Row: { id: string; tenant_id: string; agenda_id: string; title: string; description: string | null; scheduled_time: string | null; duration_minutes: number; frequency: Database["public"]["Enums"]["agenda_frequency"]; weekdays: number[]; day_of_month: number | null; fixed_date: string | null; sort: number; active: boolean; flexible: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; agenda_id: string; title: string; description?: string | null; scheduled_time?: string | null; duration_minutes?: number; frequency?: Database["public"]["Enums"]["agenda_frequency"]; weekdays?: number[]; day_of_month?: number | null; fixed_date?: string | null; sort?: number; active?: boolean; flexible?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; agenda_id?: string; title?: string; description?: string | null; scheduled_time?: string | null; duration_minutes?: number; frequency?: Database["public"]["Enums"]["agenda_frequency"]; weekdays?: number[]; day_of_month?: number | null; fixed_date?: string | null; sort?: number; active?: boolean; flexible?: boolean; created_at?: string }
        Relationships: []
      }
      agenda_logs: {
        Row: { id: string; tenant_id: string; agenda_id: string; task_id: string; log_date: string; status: Database["public"]["Enums"]["agenda_log_status"]; note: string | null; actual_minutes: number | null; done_by: string | null; done_at: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; agenda_id: string; task_id: string; log_date: string; status?: Database["public"]["Enums"]["agenda_log_status"]; note?: string | null; actual_minutes?: number | null; done_by?: string | null; done_at?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; agenda_id?: string; task_id?: string; log_date?: string; status?: Database["public"]["Enums"]["agenda_log_status"]; note?: string | null; actual_minutes?: number | null; done_by?: string | null; done_at?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      agenda_log_comments: {
        Row: { id: string; tenant_id: string; log_id: string; author_id: string; body: string; created_at: string }
        Insert: { id?: string; tenant_id: string; log_id: string; author_id: string; body: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; log_id?: string; author_id?: string; body?: string; created_at?: string }
        Relationships: []
      }
      agenda_log_attachments: {
        Row: { id: string; tenant_id: string; log_id: string; path: string; filename: string; size: number | null; content_type: string | null; uploaded_by: string; created_at: string }
        Insert: { id?: string; tenant_id: string; log_id: string; path: string; filename: string; size?: number | null; content_type?: string | null; uploaded_by: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; log_id?: string; path?: string; filename?: string; size?: number | null; content_type?: string | null; uploaded_by?: string; created_at?: string }
        Relationships: []
      }
      action_items: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          meeting_id: string | null
          occurrence_id: string | null
          priority: Database["public"]["Enums"]["priority_level"]
          status: Database["public"]["Enums"]["action_status"]
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          meeting_id?: string | null
          occurrence_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"]
          status?: Database["public"]["Enums"]["action_status"]
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          meeting_id?: string | null
          occurrence_id?: string | null
          priority?: Database["public"]["Enums"]["priority_level"]
          status?: Database["public"]["Enums"]["action_status"]
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_items_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          changes: Json | null
          created_at: string
          entity_id: string | null
          entity_label: string | null
          entity_type: string
          id: number
          summary: string | null
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_label?: string | null
          entity_type: string
          id?: never
          summary?: string | null
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_label?: string | null
          entity_type?: string
          id?: never
          summary?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_updates: {
        Row: {
          created_at: string
          created_by: string | null
          goal_id: string
          id: string
          note: string | null
          value: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          goal_id: string
          id?: string
          note?: string | null
          value: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          goal_id?: string
          id?: string
          note?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "goal_updates_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          created_at: string
          created_by: string | null
          current_value: number
          description: string | null
          id: string
          owner_id: string | null
          period_end: string | null
          period_start: string | null
          status: Database["public"]["Enums"]["goal_status"]
          target_value: number
          tenant_id: string
          title: string
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_value?: number
          description?: string | null
          id?: string
          owner_id?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: Database["public"]["Enums"]["goal_status"]
          target_value?: number
          tenant_id: string
          title: string
          unit?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_value?: number
          description?: string | null
          id?: string
          owner_id?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: Database["public"]["Enums"]["goal_status"]
          target_value?: number
          tenant_id?: string
          title?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_participants: {
        Row: {
          created_at: string
          meeting_id: string
          response: Database["public"]["Enums"]["participant_response"]
          user_id: string
        }
        Insert: {
          created_at?: string
          meeting_id: string
          response?: Database["public"]["Enums"]["participant_response"]
          user_id: string
        }
        Update: {
          created_at?: string
          meeting_id?: string
          response?: Database["public"]["Enums"]["participant_response"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_participants_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string
          ics_sequence: number
          id: string
          organizer_id: string | null
          room_id: string | null
          series_id: string | null
          series_slot: string | null
          series_detached: boolean
          starts_at: string
          status: Database["public"]["Enums"]["meeting_status"]
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at: string
          ics_sequence?: number
          id?: string
          organizer_id?: string | null
          room_id?: string | null
          series_id?: string | null
          series_slot?: string | null
          series_detached?: boolean
          starts_at: string
          status?: Database["public"]["Enums"]["meeting_status"]
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string
          ics_sequence?: number
          id?: string
          organizer_id?: string | null
          room_id?: string | null
          series_id?: string | null
          series_slot?: string | null
          series_detached?: boolean
          starts_at?: string
          status?: Database["public"]["Enums"]["meeting_status"]
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          admission_date: string | null
          created_at: string
          department_id: string | null
          dismissed_at: string | null
          employee_code: string | null
          id: string
          is_active: boolean
          is_ticket_manager: boolean
          manager_id: string | null
          position_id: string | null
          position_level_id: string | null
          hierarchy_level_id: string | null
          role: Database["public"]["Enums"]["member_role"]
          subdepartment_id: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          admission_date?: string | null
          created_at?: string
          department_id?: string | null
          dismissed_at?: string | null
          employee_code?: string | null
          id?: string
          is_active?: boolean
          is_ticket_manager?: boolean
          manager_id?: string | null
          position_id?: string | null
          position_level_id?: string | null
          hierarchy_level_id?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          subdepartment_id?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          admission_date?: string | null
          created_at?: string
          department_id?: string | null
          dismissed_at?: string | null
          employee_code?: string | null
          id?: string
          is_active?: boolean
          is_ticket_manager?: boolean
          manager_id?: string | null
          position_id?: string | null
          position_level_id?: string | null
          hierarchy_level_id?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          subdepartment_id?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: { id: string; tenant_id: string; name: string; kind: Database["public"]["Enums"]["unit_kind"]; cnpj: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; kind?: Database["public"]["Enums"]["unit_kind"]; cnpj?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; kind?: Database["public"]["Enums"]["unit_kind"]; cnpj?: string | null; created_at?: string }
        Relationships: []
      }
      unit_modules: {
        Row: { tenant_id: string; unit_id: string; module_key: string; state: Database["public"]["Enums"]["unit_module_state"]; updated_at: string; updated_by: string | null }
        Insert: { tenant_id: string; unit_id: string; module_key: string; state?: Database["public"]["Enums"]["unit_module_state"]; updated_at?: string; updated_by?: string | null }
        Update: { tenant_id?: string; unit_id?: string; module_key?: string; state?: Database["public"]["Enums"]["unit_module_state"]; updated_at?: string; updated_by?: string | null }
        Relationships: []
      }
      platform_module_flags: {
        Row: { module_key: string; under_construction: boolean; updated_at: string }
        Insert: { module_key: string; under_construction?: boolean; updated_at?: string }
        Update: { module_key?: string; under_construction?: boolean; updated_at?: string }
        Relationships: []
      }
      platform_settings: {
        Row: { id: boolean; openai_api_key: string | null; resend_api_key: string | null; openai_model: string; openai_transcribe_model: string; updated_at: string }
        Insert: { id?: boolean; openai_api_key?: string | null; resend_api_key?: string | null; openai_model?: string; openai_transcribe_model?: string; updated_at?: string }
        Update: { id?: boolean; openai_api_key?: string | null; resend_api_key?: string | null; openai_model?: string; openai_transcribe_model?: string; updated_at?: string }
        Relationships: []
      }
      module_interest: {
        Row: { id: string; tenant_id: string; unit_id: string; module_key: string; user_id: string; hits: number; created_at: string; last_at: string }
        Insert: { id?: string; tenant_id: string; unit_id: string; module_key: string; user_id: string; hits?: number; created_at?: string; last_at?: string }
        Update: { id?: string; tenant_id?: string; unit_id?: string; module_key?: string; user_id?: string; hits?: number; created_at?: string; last_at?: string }
        Relationships: []
      }
      departments: {
        Row: { id: string; tenant_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      subdepartments: {
        Row: { id: string; tenant_id: string; department_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; department_id: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; department_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      positions: {
        Row: { id: string; tenant_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      position_levels: {
        Row: { id: string; tenant_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      // Hierarquia (Diretoria, Gerência, ...). O `rank` é o que a diferencia dos
      // demais catálogos: hierarquia tem ordem, e sem ele a lista sairia
      // alfabética, com "Analista" acima de "Diretoria".
      hierarchy_levels: {
        Row: { id: string; tenant_id: string; name: string; rank: number; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; rank?: number; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; rank?: number; active?: boolean; created_at?: string }
        Relationships: []
      }
      membership_history: {
        Row: {
          changed_by: string | null
          created_at: string
          department_id: string | null
          dismissed_at: string | null
          effective_from: string
          effective_to: string | null
          employee_code: string | null
          hierarchy_level_id: string | null
          id: string
          is_active: boolean
          manager_id: string | null
          membership_id: string
          position_id: string | null
          position_level_id: string | null
          role: Database["public"]["Enums"]["member_role"]
          source: string
          subdepartment_id: string | null
          tenant_id: string
          unit_ids: string[]
          user_id: string
        }
        // escrita é exclusiva do trigger no banco: o app nunca insere/atualiza
        Insert: never
        Update: never
        Relationships: []
      }
      membership_units: {
        Row: { membership_id: string; unit_id: string }
        Insert: { membership_id: string; unit_id: string }
        Update: { membership_id?: string; unit_id?: string }
        Relationships: []
      }
      meeting_series: {
        Row: { id: string; tenant_id: string; name: string; periodicity: Database["public"]["Enums"]["meeting_periodicity"]; next_date: string | null; start_time: string | null; auto_book: boolean; ics_sequence: number; objetivo: string | null; owner: string | null; owner_user_id: string | null; room_id: string | null; is_online: boolean; participants_text: string | null; duration_min: number | null; duration_unit: string; content: Json; general_rules: Json; how_to: Json; is_active: boolean; is_private: boolean; deleted_at: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; periodicity?: Database["public"]["Enums"]["meeting_periodicity"]; next_date?: string | null; start_time?: string | null; auto_book?: boolean; ics_sequence?: number; objetivo?: string | null; owner?: string | null; owner_user_id?: string | null; room_id?: string | null; is_online?: boolean; participants_text?: string | null; duration_min?: number | null; duration_unit?: string; content?: Json; general_rules?: Json; how_to?: Json; is_active?: boolean; is_private?: boolean; deleted_at?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; periodicity?: Database["public"]["Enums"]["meeting_periodicity"]; next_date?: string | null; start_time?: string | null; auto_book?: boolean; ics_sequence?: number; objetivo?: string | null; owner?: string | null; owner_user_id?: string | null; room_id?: string | null; is_online?: boolean; participants_text?: string | null; duration_min?: number | null; duration_unit?: string; content?: Json; general_rules?: Json; how_to?: Json; is_active?: boolean; is_private?: boolean; deleted_at?: string | null; created_by?: string | null; created_at?: string }
        Relationships: []
      }
      meeting_series_participants: {
        Row: { series_id: string; user_id: string }
        Insert: { series_id: string; user_id: string }
        Update: { series_id?: string; user_id?: string }
        Relationships: []
      }
      meeting_series_units: {
        Row: { series_id: string; unit_id: string }
        Insert: { series_id: string; unit_id: string }
        Update: { series_id?: string; unit_id?: string }
        Relationships: []
      }
      meeting_recordings: {
        Row: { id: string; tenant_id: string; occurrence_id: string; path: string; filename: string; size: number | null; content_type: string | null; duration_seconds: number | null; source: string; transcript: string | null; transcript_status: Database["public"]["Enums"]["recording_transcript_status"]; transcript_error: string | null; transcribed_at: string | null; uploaded_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; occurrence_id: string; path: string; filename: string; size?: number | null; content_type?: string | null; duration_seconds?: number | null; source?: string; transcript?: string | null; transcript_status?: Database["public"]["Enums"]["recording_transcript_status"]; transcript_error?: string | null; transcribed_at?: string | null; uploaded_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; occurrence_id?: string; path?: string; filename?: string; size?: number | null; content_type?: string | null; duration_seconds?: number | null; source?: string; transcript?: string | null; transcript_status?: Database["public"]["Enums"]["recording_transcript_status"]; transcript_error?: string | null; transcribed_at?: string | null; uploaded_by?: string | null; created_at?: string }
        Relationships: []
      }
      holidays: {
        Row: { id: string; tenant_id: string; day: string; name: string; created_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; day: string; name: string; created_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; day?: string; name?: string; created_by?: string | null; created_at?: string }
        Relationships: []
      }
      sdpo_programas: {
        Row: { id: string; tenant_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      sdpo_pilares: {
        Row: { id: string; tenant_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      sdpo_secoes: {
        Row: { id: string; tenant_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      sdpo_blocos: {
        Row: { id: string; tenant_id: string; programa_id: string | null; pilar_id: string; secao_id: string; name: string; code: string | null; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; programa_id?: string | null; pilar_id: string; secao_id: string; name: string; code?: string | null; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; programa_id?: string | null; pilar_id?: string; secao_id?: string; name?: string; code?: string | null; active?: boolean; created_at?: string }
        Relationships: []
      }
      sdpo_itens: {
        Row: { id: string; tenant_id: string; programa_id: string | null; pilar_id: string; secao_id: string; bloco_id: string | null; name: string; code: string | null; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; programa_id?: string | null; pilar_id: string; secao_id: string; bloco_id?: string | null; name: string; code?: string | null; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; programa_id?: string | null; pilar_id?: string; secao_id?: string; bloco_id?: string | null; name?: string; code?: string | null; active?: boolean; created_at?: string }
        Relationships: []
      }
      action_kpis: {
        Row: { id: string; tenant_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      action_tools: {
        Row: { id: string; tenant_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      actions: {
        Row: { id: string; code: number; tenant_id: string; is_sdpo: boolean; pilar_id: string | null; secao_id: string | null; bloco_id: string | null; item_id: string | null; meeting_series_id: string | null; occurrence_id: string | null; kpi_id: string | null; tool_id: string | null; unit_id: string | null; department_id: string | null; subdepartment_id: string | null; requester_id: string | null; problem_statement: string | null; due_date: string | null; priority: Database["public"]["Enums"]["priority_level"]; created_by: string | null; created_at: string; updated_at: string; legacy_pilar: string | null; legacy_secao: string | null; legacy_bloco: string | null; legacy_item: string | null; legacy_requester: string | null; legacy_created_by: string | null; legacy_meeting: string | null; legacy_unit: string | null; legacy_kpi: string | null; legacy_tool: string | null; programa_id: string | null; legacy_programa: string | null }
        Insert: { id?: string; code?: number; tenant_id: string; is_sdpo?: boolean; pilar_id?: string | null; secao_id?: string | null; bloco_id?: string | null; item_id?: string | null; meeting_series_id?: string | null; occurrence_id?: string | null; kpi_id?: string | null; tool_id?: string | null; unit_id?: string | null; department_id?: string | null; subdepartment_id?: string | null; requester_id?: string | null; problem_statement?: string | null; due_date?: string | null; priority?: Database["public"]["Enums"]["priority_level"]; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; code?: number; tenant_id?: string; is_sdpo?: boolean; pilar_id?: string | null; secao_id?: string | null; bloco_id?: string | null; item_id?: string | null; meeting_series_id?: string | null; occurrence_id?: string | null; kpi_id?: string | null; tool_id?: string | null; unit_id?: string | null; department_id?: string | null; subdepartment_id?: string | null; requester_id?: string | null; problem_statement?: string | null; due_date?: string | null; priority?: Database["public"]["Enums"]["priority_level"]; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      action_demandas: {
        Row: { id: string; action_id: string; tenant_id: string; description: string; status: Database["public"]["Enums"]["action_status"]; due_date: string | null; completed_at: string | null; created_at: string; legacy_assignees: string | null }
        Insert: { id?: string; action_id: string; tenant_id: string; description: string; status?: Database["public"]["Enums"]["action_status"]; due_date?: string | null; completed_at?: string | null; created_at?: string }
        Update: { id?: string; action_id?: string; tenant_id?: string; description?: string; status?: Database["public"]["Enums"]["action_status"]; due_date?: string | null; completed_at?: string | null; created_at?: string }
        Relationships: []
      }
      demanda_requests: {
        Row: { id: string; tenant_id: string; demanda_id: string; type: string; status: string; requested_by: string | null; new_due_date: string | null; note: string | null; decided_by: string | null; decided_at: string | null; decision_note: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; demanda_id: string; type: string; status?: string; requested_by?: string | null; new_due_date?: string | null; note?: string | null; decided_by?: string | null; decided_at?: string | null; decision_note?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; demanda_id?: string; type?: string; status?: string; requested_by?: string | null; new_due_date?: string | null; note?: string | null; decided_by?: string | null; decided_at?: string | null; decision_note?: string | null; created_at?: string }
        Relationships: []
      }
      demanda_events: {
        Row: { id: string; tenant_id: string; demanda_id: string; type: string; actor_id: string | null; body: string | null; meta: Json; created_at: string }
        Insert: { id?: string; tenant_id: string; demanda_id: string; type: string; actor_id?: string | null; body?: string | null; meta?: Json; created_at?: string }
        Update: { id?: string; tenant_id?: string; demanda_id?: string; type?: string; actor_id?: string | null; body?: string | null; meta?: Json; created_at?: string }
        Relationships: []
      }
      notifications: {
        Row: { id: string; tenant_id: string; user_id: string; type: string; title: string; body: string | null; demanda_id: string | null; planner_board_id: string | null; is_read: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; user_id: string; type: string; title: string; body?: string | null; demanda_id?: string | null; planner_board_id?: string | null; is_read?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; user_id?: string; type?: string; title?: string; body?: string | null; demanda_id?: string | null; planner_board_id?: string | null; is_read?: boolean; created_at?: string }
        Relationships: []
      }
      action_demanda_assignees: {
        Row: { demanda_id: string; user_id: string; done_requested_at: string | null; completed_at: string | null }
        Insert: { demanda_id: string; user_id: string; done_requested_at?: string | null; completed_at?: string | null }
        Update: { demanda_id?: string; user_id?: string; done_requested_at?: string | null; completed_at?: string | null }
        Relationships: []
      }
      action_cc: {
        Row: { action_id: string; user_id: string }
        Insert: { action_id: string; user_id: string }
        Update: { action_id?: string; user_id?: string }
        Relationships: []
      }
      action_attachments: {
        Row: { id: string; action_id: string; demanda_id: string | null; tenant_id: string; path: string; filename: string; size: number | null; content_type: string | null; uploaded_by: string | null; created_at: string }
        Insert: { id?: string; action_id: string; demanda_id?: string | null; tenant_id: string; path: string; filename: string; size?: number | null; content_type?: string | null; uploaded_by?: string | null; created_at?: string }
        Update: { id?: string; action_id?: string; demanda_id?: string | null; tenant_id?: string; path?: string; filename?: string; size?: number | null; content_type?: string | null; uploaded_by?: string | null; created_at?: string }
        Relationships: []
      }
      ticket_sectors: {
        Row: { id: string; tenant_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      ticket_manager_sectors: {
        Row: { id: string; tenant_id: string; user_id: string; sector_id: string; created_at: string }
        Insert: { id?: string; tenant_id: string; user_id: string; sector_id: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; user_id?: string; sector_id?: string; created_at?: string }
        Relationships: []
      }
      ticket_categories: {
        Row: { id: string; tenant_id: string; sector_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; sector_id: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; sector_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      ticket_slas: {
        Row: { id: string; tenant_id: string; category_id: string; priority: Database["public"]["Enums"]["priority_level"] | null; sla_value: number; sla_unit: Database["public"]["Enums"]["ticket_sla_unit"]; created_at: string }
        Insert: { id?: string; tenant_id: string; category_id: string; priority?: Database["public"]["Enums"]["priority_level"] | null; sla_value: number; sla_unit?: Database["public"]["Enums"]["ticket_sla_unit"]; created_at?: string }
        Update: { id?: string; tenant_id?: string; category_id?: string; priority?: Database["public"]["Enums"]["priority_level"] | null; sla_value?: number; sla_unit?: Database["public"]["Enums"]["ticket_sla_unit"]; created_at?: string }
        Relationships: []
      }
      ticket_attachments: {
        Row: { id: string; tenant_id: string; ticket_id: string; path: string; filename: string; size: number | null; content_type: string | null; uploaded_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; ticket_id: string; path: string; filename: string; size?: number | null; content_type?: string | null; uploaded_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; ticket_id?: string; path?: string; filename?: string; size?: number | null; content_type?: string | null; uploaded_by?: string | null; created_at?: string }
        Relationships: []
      }
      individual_goals: {
        Row: { id: string; tenant_id: string; owner_id: string; name: string; description: string | null; unit: string; direction: Database["public"]["Enums"]["goal_direction"]; partial_pct: number | null; evidence_required: boolean; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; owner_id: string; name: string; description?: string | null; unit?: string; direction?: Database["public"]["Enums"]["goal_direction"]; partial_pct?: number | null; evidence_required?: boolean; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; owner_id?: string; name?: string; description?: string | null; unit?: string; direction?: Database["public"]["Enums"]["goal_direction"]; partial_pct?: number | null; evidence_required?: boolean; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      individual_goal_entries: {
        Row: { id: string; tenant_id: string; goal_id: string; period: string; target_value: number; actual_value: number | null; weight: number; note: string | null; partial_value: number | null; rv_value: number | null; approval_status: Enums<"goal_entry_status">; approved_by: string | null; approved_at: string | null; reproval_note: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; goal_id: string; period: string; target_value: number; actual_value?: number | null; weight?: number; note?: string | null; partial_value?: number | null; rv_value?: number | null; approval_status?: Enums<"goal_entry_status">; approved_by?: string | null; approved_at?: string | null; reproval_note?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; goal_id?: string; period?: string; target_value?: number; actual_value?: number | null; weight?: number; note?: string | null; partial_value?: number | null; rv_value?: number | null; approval_status?: Enums<"goal_entry_status">; approved_by?: string | null; approved_at?: string | null; reproval_note?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      individual_goal_entry_attachments: {
        Row: { id: string; tenant_id: string; entry_id: string; path: string; filename: string; size: number | null; content_type: string | null; uploaded_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; entry_id: string; path: string; filename: string; size?: number | null; content_type?: string | null; uploaded_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; entry_id?: string; path?: string; filename?: string; size?: number | null; content_type?: string | null; uploaded_by?: string | null; created_at?: string }
        Relationships: []
      }
      individual_rv_config: {
        Row: { id: string; tenant_id: string; scope: string; position_id: string | null; user_id: string | null; effective_from: string; value: number; created_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; scope: string; position_id?: string | null; user_id?: string | null; effective_from: string; value?: number; created_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; scope?: string; position_id?: string | null; user_id?: string | null; effective_from?: string; value?: number; created_by?: string | null; created_at?: string }
        Relationships: []
      }
      // Férias e afastamentos. `discounts_rv` é separado de `kind` de propósito: o
      // tipo diz o que foi, a marcação diz se reduz a remuneração variável daquele
      // mês. Um atestado de um dia e um de trinta não têm o mesmo peso, e isso é
      // política da empresa, não do esquema.
      employee_absences: {
        Row: { id: string; tenant_id: string; user_id: string; kind: Database["public"]["Enums"]["absence_kind"]; start_date: string; end_date: string; discounts_rv: boolean; note: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; user_id: string; kind?: Database["public"]["Enums"]["absence_kind"]; start_date: string; end_date: string; discounts_rv?: boolean; note?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; user_id?: string; kind?: Database["public"]["Enums"]["absence_kind"]; start_date?: string; end_date?: string; discounts_rv?: boolean; note?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      // Contratos ENCERRADOS do colaborador (vínculos anteriores, com outra
      // matrícula). A importação em lote arquiva aqui ao detectar recontratação,
      // e as importações de férias/punições/RV consultam para aceitar
      // lançamento de histórico pela matrícula antiga.
      employee_contracts: {
        Row: { id: string; tenant_id: string; user_id: string; employee_code: string | null; admission_date: string | null; dismissed_at: string | null; department_id: string | null; subdepartment_id: string | null; position_id: string | null; position_level_id: string | null; source: string; created_at: string }
        Insert: { id?: string; tenant_id: string; user_id: string; employee_code?: string | null; admission_date?: string | null; dismissed_at?: string | null; department_id?: string | null; subdepartment_id?: string | null; position_id?: string | null; position_level_id?: string | null; source?: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; user_id?: string; employee_code?: string | null; admission_date?: string | null; dismissed_at?: string | null; department_id?: string | null; subdepartment_id?: string | null; position_id?: string | null; position_level_id?: string | null; source?: string; created_at?: string }
        Relationships: []
      }
      // ---- redutores da remuneração variável ----
      // O catálogo de punições e as REGRAS são configuração: leitura para
      // qualquer membro. `employee_sanctions` é dado disciplinar, e a leitura é
      // owner/admin/manager — a tela de Metas chega nele pelo service client e
      // manda ao cliente só o percentual, nunca a lista.
      sanction_types: {
        Row: { id: string; tenant_id: string; name: string; active: boolean; sort: number; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; name: string; active?: boolean; sort?: number; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; active?: boolean; sort?: number; created_at?: string; updated_at?: string }
        Relationships: []
      }
      employee_sanctions: {
        Row: { id: string; tenant_id: string; user_id: string; sanction_type_id: string; occurred_on: string; note: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; user_id: string; sanction_type_id: string; occurred_on: string; note?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; user_id?: string; sanction_type_id?: string; occurred_on?: string; note?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      rv_reducer_rules: {
        Row: { id: string; tenant_id: string; name: string; source: Database["public"]["Enums"]["rv_reducer_source"]; absence_kind: Database["public"]["Enums"]["absence_kind"] | null; sanction_type_id: string | null; active: boolean; sort: number; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; name: string; source: Database["public"]["Enums"]["rv_reducer_source"]; absence_kind?: Database["public"]["Enums"]["absence_kind"] | null; sanction_type_id?: string | null; active?: boolean; sort?: number; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; source?: Database["public"]["Enums"]["rv_reducer_source"]; absence_kind?: Database["public"]["Enums"]["absence_kind"] | null; sanction_type_id?: string | null; active?: boolean; sort?: number; created_at?: string; updated_at?: string }
        Relationships: []
      }
      rv_reducer_bands: {
        Row: { id: string; rule_id: string; tenant_id: string; min_qtd: number; max_qtd: number | null; reduction_pct: number; created_at: string }
        Insert: { id?: string; rule_id: string; tenant_id: string; min_qtd?: number; max_qtd?: number | null; reduction_pct: number; created_at?: string }
        Update: { id?: string; rule_id?: string; tenant_id?: string; min_qtd?: number; max_qtd?: number | null; reduction_pct?: number; created_at?: string }
        Relationships: []
      }
      // ---- congelamento da competência ----
      // `rv_period_locks` guarda SÓ as competências fechadas: reabrir apaga a
      // linha, e quem fechou/reabriu fica em `audit_logs`.
      rv_period_locks: {
        Row: { id: string; tenant_id: string; period: string; locked_at: string; locked_by: string | null; note: string | null; closed_entry_ids: string[] }
        Insert: { id?: string; tenant_id: string; period: string; locked_at?: string; locked_by?: string | null; note?: string | null; closed_entry_ids?: string[] }
        Update: { id?: string; tenant_id?: string; period?: string; locked_at?: string; locked_by?: string | null; note?: string | null; closed_entry_ids?: string[] }
        Relationships: []
      }
      // O retrato dos três números que vêm de fora do lançamento da meta, um por
      // colaborador que tinha pote na competência. `detail` traz os motivos do
      // corte, para o aviso da tela continuar explicando o valor menor.
      // as colunas de vínculo (setor, função, gestor, unidades) são o carimbo da
      // época do fechamento; nulas em retratos anteriores ao carimbo
      rv_period_snapshots: {
        Row: { id: string; tenant_id: string; period: string; user_id: string; rv_full: number; prop_factor: number; reducer_pct: number; pool: number; detail: Json; created_at: string; department_id: string | null; subdepartment_id: string | null; position_id: string | null; manager_id: string | null; unit_ids: string[] }
        Insert: { id?: string; tenant_id: string; period: string; user_id: string; rv_full: number; prop_factor?: number; reducer_pct?: number; pool: number; detail?: Json; created_at?: string; department_id?: string | null; subdepartment_id?: string | null; position_id?: string | null; manager_id?: string | null; unit_ids?: string[] }
        Update: { id?: string; tenant_id?: string; period?: string; user_id?: string; rv_full?: number; prop_factor?: number; reducer_pct?: number; pool?: number; detail?: Json; created_at?: string; department_id?: string | null; subdepartment_id?: string | null; position_id?: string | null; manager_id?: string | null; unit_ids?: string[] }
        Relationships: []
      }
      // ---- Planner (kanban) ----
      // Três círculos de acesso, resolvidos pelas funções my_*_planner_board_ids:
      // dono (created_by), participante (dono ∪ membros) e visível (participante
      // ∪ gestor de qualquer participante, leitura). `board_id` é denormalizado
      // em tasks/assignees para a RLS resolver em um salto. `position` é inteiro
      // esparso (passo 1024); a ordenação é decisão de aplicação.
      planner_boards: {
        Row: { id: string; tenant_id: string; name: string; description: string | null; created_by: string; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; name: string; description?: string | null; created_by: string; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; description?: string | null; created_by?: string; created_at?: string; updated_at?: string }
        Relationships: []
      }
      planner_board_members: {
        Row: { id: string; board_id: string; user_id: string; tenant_id: string; added_by: string | null; created_at: string }
        Insert: { id?: string; board_id: string; user_id: string; tenant_id: string; added_by?: string | null; created_at?: string }
        Update: { id?: string; board_id?: string; user_id?: string; tenant_id?: string; added_by?: string | null; created_at?: string }
        Relationships: []
      }
      planner_buckets: {
        Row: { id: string; tenant_id: string; board_id: string; name: string; position: number; color: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; board_id: string; name: string; position: number; color?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; board_id?: string; name?: string; position?: number; color?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      // v2: `progress` é a fonte de verdade do estado (completed_at virou
      // carimbo de quando concluiu); `recurrence` clona a tarefa ao concluir;
      // `due_notified_at` é o dedupe do cron de prazos.
      planner_tasks: {
        Row: { id: string; tenant_id: string; board_id: string; bucket_id: string; title: string; description: string | null; start_date: string | null; due_date: string | null; priority: Database["public"]["Enums"]["priority_level"] | null; progress: Database["public"]["Enums"]["planner_progress"]; recurrence: Database["public"]["Enums"]["planner_recurrence"]; completed_at: string | null; due_notified_at: string | null; position: number; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; board_id: string; bucket_id: string; title: string; description?: string | null; start_date?: string | null; due_date?: string | null; priority?: Database["public"]["Enums"]["priority_level"] | null; progress?: Database["public"]["Enums"]["planner_progress"]; recurrence?: Database["public"]["Enums"]["planner_recurrence"]; completed_at?: string | null; due_notified_at?: string | null; position: number; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; board_id?: string; bucket_id?: string; title?: string; description?: string | null; start_date?: string | null; due_date?: string | null; priority?: Database["public"]["Enums"]["priority_level"] | null; progress?: Database["public"]["Enums"]["planner_progress"]; recurrence?: Database["public"]["Enums"]["planner_recurrence"]; completed_at?: string | null; due_notified_at?: string | null; position?: number; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      planner_labels: {
        Row: { id: string; tenant_id: string; board_id: string; name: string; color: string; created_at: string }
        Insert: { id?: string; tenant_id: string; board_id: string; name: string; color: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; board_id?: string; name?: string; color?: string; created_at?: string }
        Relationships: []
      }
      planner_task_labels: {
        Row: { task_id: string; label_id: string; tenant_id: string; board_id: string }
        Insert: { task_id: string; label_id: string; tenant_id: string; board_id: string }
        Update: { task_id?: string; label_id?: string; tenant_id?: string; board_id?: string }
        Relationships: []
      }
      planner_checklist_items: {
        Row: { id: string; tenant_id: string; board_id: string; task_id: string; title: string; done: boolean; position: number; created_at: string }
        Insert: { id?: string; tenant_id: string; board_id: string; task_id: string; title: string; done?: boolean; position: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; board_id?: string; task_id?: string; title?: string; done?: boolean; position?: number; created_at?: string }
        Relationships: []
      }
      // comentário: só o autor apaga; histórico (events): append-only, sem
      // policy de update/delete — uma linha de histórico editável não é histórico
      planner_task_comments: {
        Row: { id: string; tenant_id: string; board_id: string; task_id: string; author_id: string; body: string; created_at: string }
        Insert: { id?: string; tenant_id: string; board_id: string; task_id: string; author_id: string; body: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; board_id?: string; task_id?: string; author_id?: string; body?: string; created_at?: string }
        Relationships: []
      }
      planner_task_attachments: {
        Row: { id: string; tenant_id: string; board_id: string; task_id: string; file_path: string; file_name: string; mime_type: string | null; size_bytes: number | null; uploaded_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; board_id: string; task_id: string; file_path: string; file_name: string; mime_type?: string | null; size_bytes?: number | null; uploaded_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; board_id?: string; task_id?: string; file_path?: string; file_name?: string; mime_type?: string | null; size_bytes?: number | null; uploaded_by?: string | null; created_at?: string }
        Relationships: []
      }
      planner_task_events: {
        Row: { id: string; tenant_id: string; board_id: string; task_id: string; actor_id: string | null; type: string; meta: Json; created_at: string }
        Insert: { id?: string; tenant_id: string; board_id: string; task_id: string; actor_id?: string | null; type: string; meta?: Json; created_at?: string }
        Update: { id?: string; tenant_id?: string; board_id?: string; task_id?: string; actor_id?: string | null; type?: string; meta?: Json; created_at?: string }
        Relationships: []
      }
      planner_task_assignees: {
        Row: { task_id: string; user_id: string; tenant_id: string; board_id: string; created_at: string }
        Insert: { task_id: string; user_id: string; tenant_id: string; board_id: string; created_at?: string }
        Update: { task_id?: string; user_id?: string; tenant_id?: string; board_id?: string; created_at?: string }
        Relationships: []
      }
      area_goals: {
        Row: { id: string; tenant_id: string; department_id: string | null; subdepartment_id: string | null; unit_id: string | null; parent_id: string | null; name: string; description: string | null; unit: string; kind: Database["public"]["Enums"]["area_goal_kind"]; direction: Database["public"]["Enums"]["goal_direction"]; consolidation: Database["public"]["Enums"]["area_consolidation"]; owner_id: string | null; sort: number; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; department_id?: string | null; subdepartment_id?: string | null; unit_id?: string | null; parent_id?: string | null; name: string; description?: string | null; unit?: string; kind?: Database["public"]["Enums"]["area_goal_kind"]; direction?: Database["public"]["Enums"]["goal_direction"]; consolidation?: Database["public"]["Enums"]["area_consolidation"]; owner_id?: string | null; sort?: number; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; department_id?: string | null; subdepartment_id?: string | null; unit_id?: string | null; parent_id?: string | null; name?: string; description?: string | null; unit?: string; kind?: Database["public"]["Enums"]["area_goal_kind"]; direction?: Database["public"]["Enums"]["goal_direction"]; consolidation?: Database["public"]["Enums"]["area_consolidation"]; owner_id?: string | null; sort?: number; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      area_goal_entries: {
        Row: { id: string; tenant_id: string; area_goal_id: string; unit_id: string | null; period: string; target_value: number | null; actual_value: number | null; numerator_value: number | null; denominator_value: number | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; area_goal_id: string; unit_id?: string | null; period: string; target_value?: number | null; actual_value?: number | null; numerator_value?: number | null; denominator_value?: number | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; area_goal_id?: string; unit_id?: string | null; period?: string; target_value?: number | null; actual_value?: number | null; numerator_value?: number | null; denominator_value?: number | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      pnr_categories: {
        Row: { id: string; tenant_id: string; name: string; sort: number; max_points: number | null; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; sort?: number; max_points?: number | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; sort?: number; max_points?: number | null; created_at?: string }
        Relationships: []
      }
      pnr_kpis: {
        Row: { id: string; tenant_id: string; category_id: string | null; sort: number; name: string; description: string | null; owner_id: string | null; unit: string; direction: Database["public"]["Enums"]["goal_direction"]; consolidation: Database["public"]["Enums"]["area_consolidation"]; max_points: number; target: number | null; partial_high: number | null; partial_low: number | null; points_high: number | null; points_low: number | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; category_id?: string | null; sort?: number; name: string; description?: string | null; owner_id?: string | null; unit?: string; direction?: Database["public"]["Enums"]["goal_direction"]; consolidation?: Database["public"]["Enums"]["area_consolidation"]; max_points?: number; target?: number | null; partial_high?: number | null; partial_low?: number | null; points_high?: number | null; points_low?: number | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; category_id?: string | null; sort?: number; name?: string; description?: string | null; owner_id?: string | null; unit?: string; direction?: Database["public"]["Enums"]["goal_direction"]; consolidation?: Database["public"]["Enums"]["area_consolidation"]; max_points?: number; target?: number | null; partial_high?: number | null; partial_low?: number | null; points_high?: number | null; points_low?: number | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      pnr_entries: {
        Row: { id: string; tenant_id: string; kpi_id: string; period: string; actual_value: number | null; numerator_value: number | null; denominator_value: number | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; kpi_id: string; period: string; actual_value?: number | null; numerator_value?: number | null; denominator_value?: number | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; kpi_id?: string; period?: string; actual_value?: number | null; numerator_value?: number | null; denominator_value?: number | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      feedback_competencies: {
        Row: { id: string; tenant_id: string; name: string; sort: number; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; sort?: number; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; sort?: number; active?: boolean; created_at?: string }
        Relationships: []
      }
      feedbacks: {
        Row: { id: string; tenant_id: string; subject_user_id: string; author_id: string; feedback_date: string; type: Database["public"]["Enums"]["feedback_type"]; channel: Database["public"]["Enums"]["feedback_channel"] | null; title: string | null; situation: string | null; behavior: string | null; impact: string | null; next_steps: string | null; notes: string | null; visibility: Database["public"]["Enums"]["feedback_visibility"]; applied_at: string | null; acknowledged_at: string | null; subject_department_id: string | null; subject_position_id: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; subject_user_id: string; author_id: string; feedback_date: string; type: Database["public"]["Enums"]["feedback_type"]; channel?: Database["public"]["Enums"]["feedback_channel"] | null; title?: string | null; situation?: string | null; behavior?: string | null; impact?: string | null; next_steps?: string | null; notes?: string | null; visibility?: Database["public"]["Enums"]["feedback_visibility"]; applied_at?: string | null; acknowledged_at?: string | null; subject_department_id?: string | null; subject_position_id?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; subject_user_id?: string; author_id?: string; feedback_date?: string; type?: Database["public"]["Enums"]["feedback_type"]; channel?: Database["public"]["Enums"]["feedback_channel"] | null; title?: string | null; situation?: string | null; behavior?: string | null; impact?: string | null; next_steps?: string | null; notes?: string | null; visibility?: Database["public"]["Enums"]["feedback_visibility"]; applied_at?: string | null; acknowledged_at?: string | null; subject_department_id?: string | null; subject_position_id?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      feedback_sessions: {
        Row: { id: string; tenant_id: string; subject_user_id: string; author_id: string; session_date: string; reference_month: string | null; title: string | null; highlights: string | null; development: string | null; action_plan: string | null; overall: string | null; visibility: Database["public"]["Enums"]["feedback_visibility"]; applied_at: string | null; acknowledged_at: string | null; subject_department_id: string | null; subject_position_id: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; subject_user_id: string; author_id: string; session_date: string; reference_month?: string | null; title?: string | null; highlights?: string | null; development?: string | null; action_plan?: string | null; overall?: string | null; visibility?: Database["public"]["Enums"]["feedback_visibility"]; applied_at?: string | null; acknowledged_at?: string | null; subject_department_id?: string | null; subject_position_id?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; subject_user_id?: string; author_id?: string; session_date?: string; reference_month?: string | null; title?: string | null; highlights?: string | null; development?: string | null; action_plan?: string | null; overall?: string | null; visibility?: Database["public"]["Enums"]["feedback_visibility"]; applied_at?: string | null; acknowledged_at?: string | null; subject_department_id?: string | null; subject_position_id?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      feedback_session_items: {
        Row: { session_id: string; feedback_id: string; tenant_id: string }
        Insert: { session_id: string; feedback_id: string; tenant_id: string }
        Update: { session_id?: string; feedback_id?: string; tenant_id?: string }
        Relationships: []
      }
      feedback_settings: {
        Row: { tenant_id: string; cadence_days: number; updated_at: string }
        Insert: { tenant_id: string; cadence_days?: number; updated_at?: string }
        Update: { tenant_id?: string; cadence_days?: number; updated_at?: string }
        Relationships: []
      }
      feedback_cadence_rules: {
        Row: { id: string; tenant_id: string; department_id: string; position_id: string; cadence_days: number; updated_at: string }
        Insert: { id?: string; tenant_id: string; department_id: string; position_id: string; cadence_days?: number; updated_at?: string }
        Update: { id?: string; tenant_id?: string; department_id?: string; position_id?: string; cadence_days?: number; updated_at?: string }
        Relationships: []
      }
      pdi_actions: {
        Row: { id: string; tenant_id: string; subject_user_id: string; created_by: string; source_feedback_id: string | null; title: string; description: string | null; status: Database["public"]["Enums"]["pdi_action_status"]; due_date: string | null; completed_at: string | null; completed_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; subject_user_id: string; created_by: string; source_feedback_id?: string | null; title: string; description?: string | null; status?: Database["public"]["Enums"]["pdi_action_status"]; due_date?: string | null; completed_at?: string | null; completed_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; subject_user_id?: string; created_by?: string; source_feedback_id?: string | null; title?: string; description?: string | null; status?: Database["public"]["Enums"]["pdi_action_status"]; due_date?: string | null; completed_at?: string | null; completed_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      pdi_action_comments: {
        Row: { id: string; tenant_id: string; action_id: string; author_id: string; body: string; created_at: string }
        Insert: { id?: string; tenant_id: string; action_id: string; author_id: string; body: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; action_id?: string; author_id?: string; body?: string; created_at?: string }
        Relationships: []
      }
      sustainability_kpis: {
        Row: { id: string; tenant_id: string; sort: number; name: string; owner_id: string | null; unit: string; direction: Database["public"]["Enums"]["goal_direction"]; consolidation: Database["public"]["Enums"]["area_consolidation"]; target: number | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; sort?: number; name: string; owner_id?: string | null; unit?: string; direction?: Database["public"]["Enums"]["goal_direction"]; consolidation?: Database["public"]["Enums"]["area_consolidation"]; target?: number | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; sort?: number; name?: string; owner_id?: string | null; unit?: string; direction?: Database["public"]["Enums"]["goal_direction"]; consolidation?: Database["public"]["Enums"]["area_consolidation"]; target?: number | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      sustainability_entries: {
        Row: { id: string; tenant_id: string; kpi_id: string; period: string; actual_value: number | null; numerator_value: number | null; denominator_value: number | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; kpi_id: string; period: string; actual_value?: number | null; numerator_value?: number | null; denominator_value?: number | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; kpi_id?: string; period?: string; actual_value?: number | null; numerator_value?: number | null; denominator_value?: number | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      checklists: {
        Row: { id: string; tenant_id: string; unit_id: string | null; name: string; description: string | null; department_id: string | null; subdepartment_id: string | null; visibility: Database["public"]["Enums"]["checklist_visibility"]; default_assignee_id: string | null; auto_open_tasks: boolean; created_by: string; active: boolean; created_at: string; updated_at: string }
        Insert: { id?: string; tenant_id: string; unit_id?: string | null; name: string; description?: string | null; department_id?: string | null; subdepartment_id?: string | null; visibility?: Database["public"]["Enums"]["checklist_visibility"]; default_assignee_id?: string | null; auto_open_tasks?: boolean; created_by: string; active?: boolean; created_at?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; unit_id?: string | null; name?: string; description?: string | null; department_id?: string | null; subdepartment_id?: string | null; visibility?: Database["public"]["Enums"]["checklist_visibility"]; default_assignee_id?: string | null; auto_open_tasks?: boolean; created_by?: string; active?: boolean; created_at?: string; updated_at?: string }
        Relationships: []
      }
      checklist_tasks: {
        Row: { id: string; tenant_id: string; checklist_id: string; run_id: string; item_id: string; unit_id: string | null; title: string; description: string | null; assignee_id: string | null; status: Database["public"]["Enums"]["checklist_task_status"]; resolution: string | null; created_by: string; created_at: string; resolved_at: string | null }
        Insert: { id?: string; tenant_id: string; checklist_id: string; run_id: string; item_id: string; unit_id?: string | null; title: string; description?: string | null; assignee_id?: string | null; status?: Database["public"]["Enums"]["checklist_task_status"]; resolution?: string | null; created_by: string; created_at?: string; resolved_at?: string | null }
        Update: { id?: string; tenant_id?: string; checklist_id?: string; run_id?: string; item_id?: string; unit_id?: string | null; title?: string; description?: string | null; assignee_id?: string | null; status?: Database["public"]["Enums"]["checklist_task_status"]; resolution?: string | null; created_by?: string; created_at?: string; resolved_at?: string | null }
        Relationships: []
      }
      checklist_task_comments: {
        Row: { id: string; tenant_id: string; task_id: string; author_id: string; body: string; created_at: string }
        Insert: { id?: string; tenant_id: string; task_id: string; author_id: string; body: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; task_id?: string; author_id?: string; body?: string; created_at?: string }
        Relationships: []
      }
      checklist_audiences: {
        Row: { id: string; tenant_id: string; checklist_id: string; kind: string; ref_id: string }
        Insert: { id?: string; tenant_id: string; checklist_id: string; kind: string; ref_id: string }
        Update: { id?: string; tenant_id?: string; checklist_id?: string; kind?: string; ref_id?: string }
        Relationships: []
      }
      checklist_items: {
        Row: { id: string; tenant_id: string; checklist_id: string; section: string | null; sort: number; label: string; help: string | null; type: Database["public"]["Enums"]["checklist_item_type"]; required: boolean; allow_photo: boolean; allow_na: boolean; require_note_on_nc: boolean; require_photo_on_nc: boolean; options: Json | null; created_at: string }
        Insert: { id?: string; tenant_id: string; checklist_id: string; section?: string | null; sort?: number; label: string; help?: string | null; type?: Database["public"]["Enums"]["checklist_item_type"]; required?: boolean; allow_photo?: boolean; allow_na?: boolean; require_note_on_nc?: boolean; require_photo_on_nc?: boolean; options?: Json | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; checklist_id?: string; section?: string | null; sort?: number; label?: string; help?: string | null; type?: Database["public"]["Enums"]["checklist_item_type"]; required?: boolean; allow_photo?: boolean; allow_na?: boolean; require_note_on_nc?: boolean; require_photo_on_nc?: boolean; options?: Json | null; created_at?: string }
        Relationships: []
      }
      checklist_schedules: {
        Row: { id: string; tenant_id: string; checklist_id: string; frequency: Database["public"]["Enums"]["checklist_frequency"]; fixed_date: string | null; weekday: number | null; day_of_month: number | null; run_time: string | null; active: boolean; created_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; checklist_id: string; frequency: Database["public"]["Enums"]["checklist_frequency"]; fixed_date?: string | null; weekday?: number | null; day_of_month?: number | null; run_time?: string | null; active?: boolean; created_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; checklist_id?: string; frequency?: Database["public"]["Enums"]["checklist_frequency"]; fixed_date?: string | null; weekday?: number | null; day_of_month?: number | null; run_time?: string | null; active?: boolean; created_by?: string | null; created_at?: string }
        Relationships: []
      }
      checklist_schedule_targets: {
        Row: { id: string; tenant_id: string; schedule_id: string; kind: string; ref_id: string }
        Insert: { id?: string; tenant_id: string; schedule_id: string; kind: string; ref_id: string }
        Update: { id?: string; tenant_id?: string; schedule_id?: string; kind?: string; ref_id?: string }
        Relationships: []
      }
      checklist_runs: {
        Row: { id: string; tenant_id: string; checklist_id: string; schedule_id: string | null; unit_id: string | null; executor_id: string; period_key: string | null; status: Database["public"]["Enums"]["checklist_run_status"]; score: number | null; conform_count: number; nonconform_count: number; na_count: number; started_at: string; completed_at: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; checklist_id: string; schedule_id?: string | null; unit_id?: string | null; executor_id: string; period_key?: string | null; status?: Database["public"]["Enums"]["checklist_run_status"]; score?: number | null; conform_count?: number; nonconform_count?: number; na_count?: number; started_at?: string; completed_at?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; checklist_id?: string; schedule_id?: string | null; unit_id?: string | null; executor_id?: string; period_key?: string | null; status?: Database["public"]["Enums"]["checklist_run_status"]; score?: number | null; conform_count?: number; nonconform_count?: number; na_count?: number; started_at?: string; completed_at?: string | null; created_at?: string }
        Relationships: []
      }
      checklist_run_answers: {
        Row: { id: string; tenant_id: string; run_id: string; item_id: string; value_conformidade: string | null; value_bool: boolean | null; value_text: string | null; value_number: number | null; value_option: string | null; note: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; run_id: string; item_id: string; value_conformidade?: string | null; value_bool?: boolean | null; value_text?: string | null; value_number?: number | null; value_option?: string | null; note?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; run_id?: string; item_id?: string; value_conformidade?: string | null; value_bool?: boolean | null; value_text?: string | null; value_number?: number | null; value_option?: string | null; note?: string | null; created_at?: string }
        Relationships: []
      }
      checklist_answer_photos: {
        Row: { id: string; tenant_id: string; run_id: string; item_id: string; path: string; filename: string; size: number | null; content_type: string | null; uploaded_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; run_id: string; item_id: string; path: string; filename: string; size?: number | null; content_type?: string | null; uploaded_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; run_id?: string; item_id?: string; path?: string; filename?: string; size?: number | null; content_type?: string | null; uploaded_by?: string | null; created_at?: string }
        Relationships: []
      }
      feedback_competency_links: {
        Row: { feedback_id: string; competency_id: string; tenant_id: string }
        Insert: { feedback_id: string; competency_id: string; tenant_id: string }
        Update: { feedback_id?: string; competency_id?: string; tenant_id?: string }
        Relationships: []
      }
      feedback_attachments: {
        Row: { id: string; tenant_id: string; feedback_id: string; path: string; filename: string; size: number | null; content_type: string | null; uploaded_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; feedback_id: string; path: string; filename: string; size?: number | null; content_type?: string | null; uploaded_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; feedback_id?: string; path?: string; filename?: string; size?: number | null; content_type?: string | null; uploaded_by?: string | null; created_at?: string }
        Relationships: []
      }
      meeting_occurrences: {
        Row: { id: string; tenant_id: string; series_id: string; occurred_on: string; notes: string | null; decisions: string | null; transcript: string | null; registered_by: string | null; created_at: string; status: Database["public"]["Enums"]["meeting_occurrence_status"]; started_at: string | null; ended_at: string | null; duration_seconds: number | null; auto_finished: boolean; room_id: string | null; meeting_link: string | null; booking_meeting_id: string | null; draft: Json | null; deleted_at: string | null }
        Insert: { id?: string; tenant_id: string; series_id: string; occurred_on?: string; notes?: string | null; decisions?: string | null; transcript?: string | null; registered_by?: string | null; created_at?: string; status?: Database["public"]["Enums"]["meeting_occurrence_status"]; started_at?: string | null; ended_at?: string | null; duration_seconds?: number | null; auto_finished?: boolean; room_id?: string | null; meeting_link?: string | null; booking_meeting_id?: string | null; draft?: Json | null; deleted_at?: string | null }
        Update: { id?: string; tenant_id?: string; series_id?: string; occurred_on?: string; notes?: string | null; decisions?: string | null; transcript?: string | null; registered_by?: string | null; created_at?: string; status?: Database["public"]["Enums"]["meeting_occurrence_status"]; started_at?: string | null; ended_at?: string | null; duration_seconds?: number | null; auto_finished?: boolean; room_id?: string | null; meeting_link?: string | null; booking_meeting_id?: string | null; draft?: Json | null; deleted_at?: string | null }
        Relationships: [
          {
            foreignKeyName: "meeting_occurrences_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "meeting_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_occurrences_registered_by_fkey"
            columns: ["registered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_occurrences_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_occurrences_booking_meeting_id_fkey"
            columns: ["booking_meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_attendance: {
        Row: { occurrence_id: string; user_id: string; present: boolean }
        Insert: { occurrence_id: string; user_id: string; present?: boolean }
        Update: { occurrence_id?: string; user_id?: string; present?: boolean }
        Relationships: []
      }
      profiles: {
        // cpf, phone, birth_date e gender NÃO estão no Row de propósito: a chave
        // pública não tem mais privilégio de SELECT nessas colunas. Quem pode ler
        // usa as RPCs meu_perfil_pessoal() e tenant_dados_pessoais().
        // Este arquivo é mantido à mão, então ele descreve o PRIVILÉGIO, não só o
        // schema: assim um .select("cpf") futuro quebra na compilação, em vez de
        // virar erro 42501 em produção. Não recoloque as colunas aqui.
        // Insert/Update seguem completos: descrevem o que a tabela aceita, e a
        // escrita só acontece pelas RPCs admin_*, que rodam como dono.
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          birth_date?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          capacity: number
          color: string
          created_at: string
          id: string
          is_active: boolean
          location: string | null
          name: string
          resources: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          capacity?: number
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          location?: string | null
          name: string
          resources?: string[]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          location?: string | null
          name?: string
          resources?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_secrets: {
        Row: {
          openai_api_key: string | null
          resend_api_key: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          openai_api_key?: string | null
          resend_api_key?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          openai_api_key?: string | null
          resend_api_key?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_secrets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          has_openai_key: boolean
          has_resend_key: boolean
          id: string
          name: string
          openai_model: string
          openai_transcribe_model: string
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          ticket_sla_mode: string
          units_limit: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          has_openai_key?: boolean
          has_resend_key?: boolean
          id?: string
          name: string
          openai_model?: string
          openai_transcribe_model?: string
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          ticket_sla_mode?: string
          units_limit?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          has_openai_key?: boolean
          has_resend_key?: boolean
          id?: string
          name?: string
          openai_model?: string
          openai_transcribe_model?: string
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          ticket_sla_mode?: string
          units_limit?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      ticket_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          ticket_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          ticket_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_comments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          approval_requested_at: string | null
          assignee_id: string | null
          category: Database["public"]["Enums"]["ticket_category"]
          category_id: string | null
          code: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          nps_comment: string | null
          nps_score: number | null
          priority: Database["public"]["Enums"]["priority_level"]
          rated_at: string | null
          requested_priority: Database["public"]["Enums"]["priority_level"] | null
          requester_id: string | null
          resolved_at: string | null
          sector_id: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          tenant_id: string
          title: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          approval_requested_at?: string | null
          assignee_id?: string | null
          category?: Database["public"]["Enums"]["ticket_category"]
          category_id?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          nps_comment?: string | null
          nps_score?: number | null
          priority?: Database["public"]["Enums"]["priority_level"]
          rated_at?: string | null
          requested_priority?: Database["public"]["Enums"]["priority_level"] | null
          requester_id?: string | null
          resolved_at?: string | null
          sector_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          tenant_id: string
          title: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          approval_requested_at?: string | null
          assignee_id?: string | null
          category?: Database["public"]["Enums"]["ticket_category"]
          category_id?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          nps_comment?: string | null
          nps_score?: number | null
          priority?: Database["public"]["Enums"]["priority_level"]
          rated_at?: string | null
          requested_priority?: Database["public"]["Enums"]["priority_level"] | null
          requester_id?: string | null
          resolved_at?: string | null
          sector_id?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          tenant_id?: string
          title?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_create_user: {
        Args: {
          p_email: string
          p_password: string
          p_full_name: string
          p_role: Database["public"]["Enums"]["member_role"]
        }
        Returns: string
      }
      admin_delete_user: { Args: { p_user: string }; Returns: undefined }
      admin_set_password: {
        Args: { p_user: string; p_password: string }
        Returns: undefined
      }
      my_active_tenant: { Args: Record<PropertyKey, never>; Returns: string }
      /**
       * Minha equipe: a cadeia INTEIRA abaixo de mim, e vazia se eu não tiver
       * papel de Gestor (`team_lead`) ou acima. É a mesma função que as policies
       * de metas, feedbacks, PDI e checklists consultam, por isso o app deve
       * chamá-la em vez de refazer a consulta (ver `src/lib/team.ts`).
       */
      my_managed_memberships: {
        Args: Record<PropertyKey, never>
        Returns: { user_id: string; tenant_id: string }[]
      }
      my_owned_planner_board_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      planner_move_task_to_board: { Args: { p_task: string; p_to_board: string; p_to_bucket: string }; Returns: undefined }
      planner_duplicate_board: { Args: { p_board: string; p_name: string; p_with_tasks: boolean }; Returns: string }
      my_planner_board_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      my_visible_planner_board_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      manages_user: {
        Args: { p_owner: string; p_tenant: string }
        Returns: boolean
      }
      create_tenant_with_owner: {
        Args: { p_name: string; p_slug: string }
        Returns: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }[]
      }
      current_tenant_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      dashboard_stats: { Args: { p_tenant: string }; Returns: Json }
      has_tenant_role: {
        Args: {
          p_roles: Database["public"]["Enums"]["member_role"][]
          p_tenant: string
        }
        Returns: boolean
      }
      is_tenant_member: { Args: { p_tenant: string }; Returns: boolean }
      set_openai_settings: {
        Args: { p_key: string; p_model: string; p_clear?: boolean }
        Returns: undefined
      }
      is_super_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      platform_set_active_tenant: { Args: { p_tenant: string }; Returns: undefined }
      email_by_cpf: { Args: { p_cpf: string }; Returns: string }
      create_action: { Args: { p_data: Json }; Returns: Json }
      update_action: { Args: { p_id: string; p_data: Json }; Returns: undefined }
      import_action: { Args: { p_data: Json }; Returns: Json }
      demanda_set_problem: { Args: { p_demanda: string; p_texto: string }; Returns: undefined }
      search_action_ids: { Args: { p_filters?: Json; p_limit?: number; p_offset?: number }; Returns: Json }
      meeting_follow_action_ids: { Args: { p_series: string; p_occurrence: string; p_cutoff: string }; Returns: string[] }
      employee_contract_history: { Args: { p_user: string }; Returns: Json }
      employee_movement_history: { Args: { p_user: string }; Returns: Json }
      action_filter_options: { Args: Record<string, never>; Returns: Json }
      auth_throttle_check: { Args: { p_chaves: Json }; Returns: Json }
      auth_throttle_falha: { Args: { p_chaves: Json }; Returns: Json }
      auth_throttle_sucesso: { Args: { p_chaves: Json }; Returns: undefined }
      modulos_em_construcao: { Args: Record<string, never>; Returns: string[] }
      meu_perfil_pessoal: {
        Args: Record<string, never>
        Returns: {
          cpf: string | null
          phone: string | null
          birth_date: string | null
          gender: Database["public"]["Enums"]["gender_type"] | null
        }[]
      }
      tenant_dados_pessoais: {
        Args: { p_tenant?: string }
        Returns: {
          id: string
          cpf: string | null
          phone: string | null
          birth_date: string | null
          gender: Database["public"]["Enums"]["gender_type"] | null
        }[]
      }
      catalog_usage: {
        Args: { p_tenant: string }
        Returns: {
          pilar_ids: string[] | null
          secao_ids: string[] | null
          bloco_ids: string[] | null
          item_ids: string[] | null
          kpi_ids: string[] | null
          tool_ids: string[] | null
          department_ids: string[] | null
          subdepartment_ids: string[] | null
          position_ids: string[] | null
          level_ids: string[] | null
          sector_ids: string[] | null
          category_ids: string[] | null
          competency_ids: string[] | null
        }[]
      }
      demanda_comment: { Args: { p_demanda: string; p_body: string }; Returns: undefined }
      add_demanda_comment_import: { Args: { p_demanda: string; p_body: string; p_actor?: string | null; p_at?: string | null; p_author_label?: string | null }; Returns: undefined }
      demanda_set_status: { Args: { p_demanda: string; p_status: Database["public"]["Enums"]["action_status"] }; Returns: undefined }
      demanda_request: { Args: { p_demanda: string; p_type: string; p_new_due: string | null; p_note: string }; Returns: undefined }
      demanda_decide: { Args: { p_request: string; p_approve: boolean; p_note: string }; Returns: undefined }
      demanda_reopen: { Args: { p_demanda: string; p_note: string }; Returns: undefined }
      demanda_cancel: { Args: { p_demanda: string; p_note: string }; Returns: undefined }
      demanda_reassign: { Args: { p_demanda: string; p_users: Json; p_note: string }; Returns: undefined }
      demanda_assignee_submit: { Args: { p_demanda: string }; Returns: undefined }
      demanda_assignee_decide: { Args: { p_demanda: string; p_user: string; p_approve: boolean; p_note: string }; Returns: undefined }
      demanda_assignee_reopen: { Args: { p_demanda: string; p_user: string; p_note: string }; Returns: undefined }
      create_meeting: { Args: { p_data: Json }; Returns: string }
      save_meeting_series: { Args: { p_data: Json }; Returns: string }
      sync_series_bookings: { Args: { p_series: string }; Returns: undefined }
      topup_all_series_bookings: { Args: Record<string, never>; Returns: undefined }
      easter_sunday: { Args: { p_year: number }; Returns: string }
      national_holiday_name: { Args: { p_date: string }; Returns: string | null }
      is_holiday: { Args: { p_tenant: string; p_date: string }; Returns: boolean }
      register_meeting_occurrence: { Args: { p_data: Json }; Returns: string }
      start_meeting_occurrence: { Args: { p_series_id: string }; Returns: string }
      anticipate_meeting_occurrence: { Args: { p_series_id: string; p_room_id?: string | null; p_link?: string | null; p_next_date?: string | null; p_next_time?: string | null }; Returns: string }
      finish_meeting_occurrence: { Args: { p_data: Json }; Returns: string }
      cancel_meeting_occurrence: { Args: { p_id: string }; Returns: undefined }
      save_occurrence_draft: { Args: { p_id: string; p_draft: Json }; Returns: undefined }
      admin_create_employee: { Args: { p_data: Json; p_password: string }; Returns: string }
      admin_update_employee: { Args: { p_user: string; p_data: Json }; Returns: undefined }
      admin_import_employees: { Args: { p_rows: Json; p_password: string }; Returns: Json }
      platform_companies: {
        Args: Record<PropertyKey, never>
        Returns: {
          id: string
          name: string
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          created_at: string
          members_count: number
          units_count: number
          units_limit: number | null
        }[]
      }
      platform_set_units_limit: {
        Args: { p_tenant: string; p_limit: number | null }
        Returns: undefined
      }
      platform_module_matrix: {
        Args: { p_tenant: string }
        Returns: {
          unit_id: string
          unit_name: string
          module_key: string
          state: Database["public"]["Enums"]["unit_module_state"] | null
        }[]
      }
      platform_set_unit_modules: {
        Args: { p_unit: string; p_modules: string[]; p_state: Database["public"]["Enums"]["unit_module_state"] }
        Returns: undefined
      }
      platform_set_tenant_modules: {
        Args: { p_tenant: string; p_modules: string[]; p_state: Database["public"]["Enums"]["unit_module_state"] }
        Returns: undefined
      }
      platform_set_module_construction: {
        Args: { p_module: string; p_under: boolean }
        Returns: undefined
      }
      platform_module_interest: {
        Args: Record<PropertyKey, never>
        Returns: {
          module_key: string
          tenant_id: string
          tenant_name: string
          unit_id: string
          unit_name: string
          users_count: number
          hits: number
          last_at: string
        }[]
      }
      register_module_interest: {
        Args: { p_units: string[]; p_module: string }
        Returns: number
      }
      platform_stats: { Args: Record<PropertyKey, never>; Returns: Json }
      platform_create_company: {
        Args: {
          p_company: string
          p_owner_email: string
          p_owner_password: string
          p_owner_name: string
        }
        Returns: string
      }
      platform_set_company_status: {
        Args: {
          p_tenant: string
          p_status: Database["public"]["Enums"]["tenant_status"]
        }
        Returns: undefined
      }
      platform_delete_company: { Args: { p_tenant: string }; Returns: undefined }
      platform_create_owner: { Args: { p_email: string; p_password: string; p_name: string }; Returns: string }
      platform_grant_admin: { Args: { p_email: string }; Returns: undefined }
      platform_revoke_admin: { Args: { p_user: string }; Returns: undefined }
      platform_admins_list: { Args: Record<PropertyKey, never>; Returns: { user_id: string; email: string; full_name: string | null; created_at: string }[] }
      notify_users: { Args: { p_tenant: string; p_users: string[]; p_type: string; p_title: string; p_body: string; p_demanda: string | null; p_planner_board?: string | null }; Returns: undefined }
      set_resend_key: { Args: { p_key: string; p_clear?: boolean }; Returns: undefined }
      platform_set_openai: { Args: { p_key: string; p_model: string; p_transcribe_model: string; p_clear?: boolean }; Returns: undefined }
      platform_set_resend: { Args: { p_key: string; p_clear?: boolean }; Returns: undefined }
      platform_integration_flags: { Args: Record<PropertyKey, never>; Returns: Json }
      ticket_request_conclusion: { Args: { p_ticket: string }; Returns: undefined }
      ticket_decide_conclusion: { Args: { p_ticket: string; p_approve: boolean; p_note: string }; Returns: undefined }
    }
    Enums: {
      agenda_frequency: "diaria" | "semanal" | "mensal" | "unica"
      agenda_log_status: "pendente" | "feito" | "parcial" | "nao_feito"
      recording_transcript_status: "pendente" | "processando" | "concluida" | "falha"
      action_status: "open" | "in_progress" | "blocked" | "done" | "cancelled"
      goal_status: "active" | "at_risk" | "achieved" | "missed" | "archived"
      // `binaria` = meta de sim/não. É marcador de INTERFACE: por baixo ela se
      // comporta como maior_melhor com meta 100 e realizado 0 ou 100, então o
      // cálculo do farol não tem caso especial nenhum.
      goal_direction: "maior_melhor" | "menor_melhor" | "binaria"
      goal_entry_status: "aberta" | "aprovada" | "reprovada"
      absence_kind: "ferias" | "licenca" | "afastamento" | "atestado" | "falta"
      rv_reducer_source: "absence" | "sanction"
      feedback_type: "reconhecimento" | "construtivo" | "neutro"
      feedback_visibility: "compartilhado" | "privado"
      feedback_channel: "presencial" | "reuniao_1a1" | "videochamada" | "mensagem" | "outro"
      pdi_action_status: "pendente" | "em_andamento" | "conclusao_solicitada" | "concluida" | "cancelada"
      checklist_visibility: "todos" | "usuarios" | "cargos" | "areas"
      checklist_item_type: "conformidade" | "sim_nao" | "texto" | "numero" | "selecao" | "nota"
      checklist_frequency: "unica" | "diaria" | "semanal" | "mensal" | "anual"
      checklist_run_status: "em_andamento" | "concluida"
      checklist_task_status: "pendente" | "em_andamento" | "concluida" | "cancelada"
      area_goal_kind: "ic" | "iv"
      area_consolidation: "soma" | "media" | "manual" | "razao"
      meeting_status: "scheduled" | "in_progress" | "done" | "cancelled"
      meeting_occurrence_status: "in_progress" | "finished" | "cancelled"
      // `team_lead` é o perfil "Gestor": vê os dados da própria equipe (cadeia
      // inteira abaixo dele), sem os poderes de empresa inteira do "Gerencial"
      // (`manager`). A ordem aqui espelha a hierarquia do enum no banco.
      member_role: "owner" | "admin" | "manager" | "team_lead" | "hr" | "member"
      planner_progress: "not_started" | "in_progress" | "done"
      planner_recurrence: "none" | "daily" | "weekly" | "monthly"
      participant_response: "invited" | "accepted" | "declined" | "tentative"
      priority_level: "low" | "medium" | "high" | "urgent"
      ticket_category:
        | "ti"
        | "servicos_gerais"
        | "facilities"
        | "rh"
        | "financeiro"
        | "outros"
      ticket_status:
        | "open"
        | "in_progress"
        | "waiting"
        | "resolved"
        | "closed"
        | "cancelled"
      ticket_sla_unit: "horas" | "dias_corridos" | "dias_uteis"
      tenant_status: "active" | "suspended" | "inactive"
      unit_kind: "matriz" | "filial"
      unit_module_state: "on" | "locked" | "hidden"
      gender_type: "masculino" | "feminino" | "outro" | "nao_informado"
      meeting_periodicity:
        | "diaria"
        | "semanal"
        | "quinzenal"
        | "mensal"
        | "bimestral"
        | "trimestral"
        | "semestral"
        | "anual"
        | "sob_demanda"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"]
export type Enums<T extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][T]
