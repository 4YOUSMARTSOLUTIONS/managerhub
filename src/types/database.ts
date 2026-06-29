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
          id: string
          organizer_id: string | null
          room_id: string | null
          series_id: string | null
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
          id?: string
          organizer_id?: string | null
          room_id?: string | null
          series_id?: string | null
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
          id?: string
          organizer_id?: string | null
          room_id?: string | null
          series_id?: string | null
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
          manager_id: string | null
          position_id: string | null
          position_level_id: string | null
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
          manager_id?: string | null
          position_id?: string | null
          position_level_id?: string | null
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
          manager_id?: string | null
          position_id?: string | null
          position_level_id?: string | null
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
      departments: {
        Row: { id: string; tenant_id: string; name: string; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; created_at?: string }
        Relationships: []
      }
      subdepartments: {
        Row: { id: string; tenant_id: string; department_id: string; name: string; created_at: string }
        Insert: { id?: string; tenant_id: string; department_id: string; name: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; department_id?: string; name?: string; created_at?: string }
        Relationships: []
      }
      positions: {
        Row: { id: string; tenant_id: string; name: string; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; created_at?: string }
        Relationships: []
      }
      position_levels: {
        Row: { id: string; tenant_id: string; name: string; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; created_at?: string }
        Relationships: []
      }
      membership_units: {
        Row: { membership_id: string; unit_id: string }
        Insert: { membership_id: string; unit_id: string }
        Update: { membership_id?: string; unit_id?: string }
        Relationships: []
      }
      meeting_series: {
        Row: { id: string; tenant_id: string; name: string; periodicity: Database["public"]["Enums"]["meeting_periodicity"]; next_date: string | null; objetivo: string | null; owner: string | null; owner_user_id: string | null; room_id: string | null; is_online: boolean; participants_text: string | null; duration_min: number | null; duration_unit: string; content: Json; general_rules: Json; how_to: Json; is_active: boolean; created_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; periodicity?: Database["public"]["Enums"]["meeting_periodicity"]; next_date?: string | null; objetivo?: string | null; owner?: string | null; owner_user_id?: string | null; room_id?: string | null; is_online?: boolean; participants_text?: string | null; duration_min?: number | null; duration_unit?: string; content?: Json; general_rules?: Json; how_to?: Json; is_active?: boolean; created_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; periodicity?: Database["public"]["Enums"]["meeting_periodicity"]; next_date?: string | null; objetivo?: string | null; owner?: string | null; owner_user_id?: string | null; room_id?: string | null; is_online?: boolean; participants_text?: string | null; duration_min?: number | null; duration_unit?: string; content?: Json; general_rules?: Json; how_to?: Json; is_active?: boolean; created_by?: string | null; created_at?: string }
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
      sdpo_pilares: {
        Row: { id: string; tenant_id: string; name: string; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; created_at?: string }
        Relationships: []
      }
      sdpo_blocos: {
        Row: { id: string; tenant_id: string; pilar_id: string; name: string; created_at: string }
        Insert: { id?: string; tenant_id: string; pilar_id: string; name: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; pilar_id?: string; name?: string; created_at?: string }
        Relationships: []
      }
      sdpo_itens: {
        Row: { id: string; tenant_id: string; bloco_id: string; name: string; created_at: string }
        Insert: { id?: string; tenant_id: string; bloco_id: string; name: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; bloco_id?: string; name?: string; created_at?: string }
        Relationships: []
      }
      action_kpis: {
        Row: { id: string; tenant_id: string; name: string; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; created_at?: string }
        Relationships: []
      }
      action_tools: {
        Row: { id: string; tenant_id: string; name: string; created_at: string }
        Insert: { id?: string; tenant_id: string; name: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; created_at?: string }
        Relationships: []
      }
      actions: {
        Row: { id: string; code: number; tenant_id: string; is_sdpo: boolean; pilar_id: string | null; bloco_id: string | null; item_id: string | null; meeting_series_id: string | null; occurrence_id: string | null; kpi_id: string | null; tool_id: string | null; requester_id: string | null; due_date: string | null; priority: Database["public"]["Enums"]["priority_level"]; created_by: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; code?: number; tenant_id: string; is_sdpo?: boolean; pilar_id?: string | null; bloco_id?: string | null; item_id?: string | null; meeting_series_id?: string | null; occurrence_id?: string | null; kpi_id?: string | null; tool_id?: string | null; requester_id?: string | null; due_date?: string | null; priority?: Database["public"]["Enums"]["priority_level"]; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; code?: number; tenant_id?: string; is_sdpo?: boolean; pilar_id?: string | null; bloco_id?: string | null; item_id?: string | null; meeting_series_id?: string | null; occurrence_id?: string | null; kpi_id?: string | null; tool_id?: string | null; requester_id?: string | null; due_date?: string | null; priority?: Database["public"]["Enums"]["priority_level"]; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: []
      }
      action_demandas: {
        Row: { id: string; action_id: string; tenant_id: string; description: string; status: Database["public"]["Enums"]["action_status"]; due_date: string | null; completed_at: string | null; created_at: string }
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
        Row: { id: string; tenant_id: string; user_id: string; type: string; title: string; body: string | null; demanda_id: string | null; is_read: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; user_id: string; type: string; title: string; body?: string | null; demanda_id?: string | null; is_read?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; user_id?: string; type?: string; title?: string; body?: string | null; demanda_id?: string | null; is_read?: boolean; created_at?: string }
        Relationships: []
      }
      action_demanda_assignees: {
        Row: { demanda_id: string; user_id: string }
        Insert: { demanda_id: string; user_id: string }
        Update: { demanda_id?: string; user_id?: string }
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
      meeting_occurrences: {
        Row: { id: string; tenant_id: string; series_id: string; occurred_on: string; notes: string | null; decisions: string | null; registered_by: string | null; created_at: string; status: Database["public"]["Enums"]["meeting_occurrence_status"]; started_at: string | null; ended_at: string | null; duration_seconds: number | null; draft: Json | null }
        Insert: { id?: string; tenant_id: string; series_id: string; occurred_on?: string; notes?: string | null; decisions?: string | null; registered_by?: string | null; created_at?: string; status?: Database["public"]["Enums"]["meeting_occurrence_status"]; started_at?: string | null; ended_at?: string | null; duration_seconds?: number | null; draft?: Json | null }
        Update: { id?: string; tenant_id?: string; series_id?: string; occurred_on?: string; notes?: string | null; decisions?: string | null; registered_by?: string | null; created_at?: string; status?: Database["public"]["Enums"]["meeting_occurrence_status"]; started_at?: string | null; ended_at?: string | null; duration_seconds?: number | null; draft?: Json | null }
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
        ]
      }
      meeting_attendance: {
        Row: { occurrence_id: string; user_id: string; present: boolean }
        Insert: { occurrence_id: string; user_id: string; present?: boolean }
        Update: { occurrence_id?: string; user_id?: string; present?: boolean }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          birth_date: string | null
          cpf: string | null
          created_at: string
          email: string | null
          full_name: string | null
          gender: Database["public"]["Enums"]["gender_type"] | null
          id: string
          phone: string | null
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
          tenant_id: string
          updated_at: string
        }
        Insert: {
          openai_api_key?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          openai_api_key?: string | null
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
          id: string
          name: string
          openai_model: string
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          units_limit: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          has_openai_key?: boolean
          id?: string
          name: string
          openai_model?: string
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          units_limit?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          has_openai_key?: boolean
          id?: string
          name?: string
          openai_model?: string
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
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
          assignee_id: string | null
          category: Database["public"]["Enums"]["ticket_category"]
          code: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: Database["public"]["Enums"]["priority_level"]
          requester_id: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          category?: Database["public"]["Enums"]["ticket_category"]
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["priority_level"]
          requester_id?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          category?: Database["public"]["Enums"]["ticket_category"]
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["priority_level"]
          requester_id?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          tenant_id?: string
          title?: string
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
      email_by_cpf: { Args: { p_cpf: string }; Returns: string }
      create_action: { Args: { p_data: Json }; Returns: Json }
      demanda_comment: { Args: { p_demanda: string; p_body: string }; Returns: undefined }
      demanda_set_status: { Args: { p_demanda: string; p_status: Database["public"]["Enums"]["action_status"] }; Returns: undefined }
      demanda_request: { Args: { p_demanda: string; p_type: string; p_new_due: string | null; p_note: string }; Returns: undefined }
      demanda_decide: { Args: { p_request: string; p_approve: boolean; p_note: string }; Returns: undefined }
      demanda_reopen: { Args: { p_demanda: string; p_note: string }; Returns: undefined }
      demanda_cancel: { Args: { p_demanda: string; p_note: string }; Returns: undefined }
      demanda_reassign: { Args: { p_demanda: string; p_users: Json; p_note: string }; Returns: undefined }
      save_meeting_series: { Args: { p_data: Json }; Returns: string }
      register_meeting_occurrence: { Args: { p_data: Json }; Returns: string }
      start_meeting_occurrence: { Args: { p_series_id: string }; Returns: string }
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
    }
    Enums: {
      action_status: "open" | "in_progress" | "blocked" | "done" | "cancelled"
      goal_status: "active" | "at_risk" | "achieved" | "missed" | "archived"
      meeting_status: "scheduled" | "in_progress" | "done" | "cancelled"
      meeting_occurrence_status: "in_progress" | "finished" | "cancelled"
      member_role: "owner" | "admin" | "manager" | "member"
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
      tenant_status: "active" | "suspended" | "inactive"
      unit_kind: "matriz" | "filial"
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
