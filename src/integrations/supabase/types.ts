export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      achievements: {
        Row: {
          created_at: string
          description: string
          display_order: number
          icon: string
          id: string
          name: string
          name_arabic: string
          requirement_type: string
          requirement_value: number | null
          xp_reward: number
        }
        Insert: {
          created_at?: string
          description: string
          display_order?: number
          icon?: string
          id?: string
          name: string
          name_arabic: string
          requirement_type?: string
          requirement_value?: number | null
          xp_reward?: number
        }
        Update: {
          created_at?: string
          description?: string
          display_order?: number
          icon?: string
          id?: string
          name?: string
          name_arabic?: string
          requirement_type?: string
          requirement_value?: number | null
          xp_reward?: number
        }
        Relationships: []
      }
      anki_import_batches: {
        Row: {
          created_at: string
          dialect: string
          id: string
          imported_cards: number
          media_uploaded: number
          notes: string | null
          skipped_duplicates: number
          source_filename: string | null
          total_cards: number
          user_id: string
        }
        Insert: {
          created_at?: string
          dialect: string
          id?: string
          imported_cards?: number
          media_uploaded?: number
          notes?: string | null
          skipped_duplicates?: number
          source_filename?: string | null
          total_cards?: number
          user_id: string
        }
        Update: {
          created_at?: string
          dialect?: string
          id?: string
          imported_cards?: number
          media_uploaded?: number
          notes?: string | null
          skipped_duplicates?: number
          source_filename?: string | null
          total_cards?: number
          user_id?: string
        }
        Relationships: []
      }
      audio_files: {
        Row: {
          channel: string | null
          created_at: string
          duration: number | null
          id: string
          source_url: string | null
          status: string
          storage_path: string
          thumbnail: string | null
          title: string | null
          updated_at: string
          video_id: string
        }
        Insert: {
          channel?: string | null
          created_at?: string
          duration?: number | null
          id?: string
          source_url?: string | null
          status?: string
          storage_path: string
          thumbnail?: string | null
          title?: string | null
          updated_at?: string
          video_id: string
        }
        Update: {
          channel?: string | null
          created_at?: string
          duration?: number | null
          id?: string
          source_url?: string | null
          status?: string
          storage_path?: string
          thumbnail?: string | null
          title?: string | null
          updated_at?: string
          video_id?: string
        }
        Relationships: []
      }
      authentic_stories: {
        Row: {
          audio_url: string | null
          author: string | null
          author_arabic: string | null
          body_dialect: string | null
          body_dialect_vocalized: string | null
          body_english: string | null
          body_fusha: string | null
          body_fusha_vocalized: string | null
          created_at: string
          created_by: string | null
          dialect: string
          difficulty: string
          duration_seconds: number | null
          id: string
          license: string
          line_durations: Json | null
          source_name: string | null
          source_url: string | null
          status: string
          story_video_approved: boolean
          story_video_error: string | null
          story_video_full_error: string | null
          story_video_full_status: string
          story_video_operation: string | null
          story_video_segments: Json
          story_video_status: string
          story_video_url: string | null
          title: string
          title_arabic: string | null
          updated_at: string
          video_preview_url: string | null
          video_status: string
          vocabulary: Json | null
        }
        Insert: {
          audio_url?: string | null
          author?: string | null
          author_arabic?: string | null
          body_dialect?: string | null
          body_dialect_vocalized?: string | null
          body_english?: string | null
          body_fusha?: string | null
          body_fusha_vocalized?: string | null
          created_at?: string
          created_by?: string | null
          dialect?: string
          difficulty?: string
          duration_seconds?: number | null
          id?: string
          license?: string
          line_durations?: Json | null
          source_name?: string | null
          source_url?: string | null
          status?: string
          story_video_approved?: boolean
          story_video_error?: string | null
          story_video_full_error?: string | null
          story_video_full_status?: string
          story_video_operation?: string | null
          story_video_segments?: Json
          story_video_status?: string
          story_video_url?: string | null
          title: string
          title_arabic?: string | null
          updated_at?: string
          video_preview_url?: string | null
          video_status?: string
          vocabulary?: Json | null
        }
        Update: {
          audio_url?: string | null
          author?: string | null
          author_arabic?: string | null
          body_dialect?: string | null
          body_dialect_vocalized?: string | null
          body_english?: string | null
          body_fusha?: string | null
          body_fusha_vocalized?: string | null
          created_at?: string
          created_by?: string | null
          dialect?: string
          difficulty?: string
          duration_seconds?: number | null
          id?: string
          license?: string
          line_durations?: Json | null
          source_name?: string | null
          source_url?: string | null
          status?: string
          story_video_approved?: boolean
          story_video_error?: string | null
          story_video_full_error?: string | null
          story_video_full_status?: string
          story_video_operation?: string | null
          story_video_segments?: Json
          story_video_status?: string
          story_video_url?: string | null
          title?: string
          title_arabic?: string | null
          updated_at?: string
          video_preview_url?: string | null
          video_status?: string
          vocabulary?: Json | null
        }
        Relationships: []
      }
      authentic_story_lines: {
        Row: {
          arabic: string
          arabic_vocalized: string | null
          audio_url: string | null
          created_at: string
          dialect: string | null
          dialect_vocalized: string | null
          duration_seconds: number | null
          english: string | null
          english_literal: string | null
          id: string
          line_index: number
          story_id: string
          updated_at: string
        }
        Insert: {
          arabic: string
          arabic_vocalized?: string | null
          audio_url?: string | null
          created_at?: string
          dialect?: string | null
          dialect_vocalized?: string | null
          duration_seconds?: number | null
          english?: string | null
          english_literal?: string | null
          id?: string
          line_index: number
          story_id: string
          updated_at?: string
        }
        Update: {
          arabic?: string
          arabic_vocalized?: string | null
          audio_url?: string | null
          created_at?: string
          dialect?: string | null
          dialect_vocalized?: string | null
          duration_seconds?: number | null
          english?: string | null
          english_literal?: string | null
          id?: string
          line_index?: number
          story_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "authentic_story_lines_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "authentic_stories"
            referencedColumns: ["id"]
          },
        ]
      }
      beta_feedback: {
        Row: {
          admin_notes: string | null
          context: Json
          created_at: string
          id: string
          message: string
          route: string | null
          screenshot_url: string | null
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          context?: Json
          created_at?: string
          id?: string
          message: string
          route?: string | null
          screenshot_url?: string | null
          status?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          context?: Json
          created_at?: string
          id?: string
          message?: string
          route?: string | null
          screenshot_url?: string | null
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bible_lessons: {
        Row: {
          book_name: string
          book_usfm: string
          chapter: number
          created_at: string
          created_by: string
          cultural_note: string | null
          description: string | null
          dialect: string
          dialect_verses: Json
          display_order: number
          english_verses: Json
          formal_verses: Json
          id: string
          published: boolean
          title: string
          updated_at: string
          verse_end: number
          verse_start: number
        }
        Insert: {
          book_name: string
          book_usfm: string
          chapter: number
          created_at?: string
          created_by: string
          cultural_note?: string | null
          description?: string | null
          dialect?: string
          dialect_verses?: Json
          display_order?: number
          english_verses?: Json
          formal_verses?: Json
          id?: string
          published?: boolean
          title: string
          updated_at?: string
          verse_end?: number
          verse_start?: number
        }
        Update: {
          book_name?: string
          book_usfm?: string
          chapter?: number
          created_at?: string
          created_by?: string
          cultural_note?: string | null
          description?: string | null
          dialect?: string
          dialect_verses?: Json
          display_order?: number
          english_verses?: Json
          formal_verses?: Json
          id?: string
          published?: boolean
          title?: string
          updated_at?: string
          verse_end?: number
          verse_start?: number
        }
        Relationships: []
      }
      challenges: {
        Row: {
          challenge_type: string
          challenged_id: string
          challenged_progress: number
          challenger_id: string
          challenger_progress: number
          completed_at: string | null
          created_at: string
          duration_days: number
          expires_at: string
          id: string
          status: string
          target_xp: number
          winner_id: string | null
        }
        Insert: {
          challenge_type?: string
          challenged_id: string
          challenged_progress?: number
          challenger_id: string
          challenger_progress?: number
          completed_at?: string | null
          created_at?: string
          duration_days?: number
          expires_at?: string
          id?: string
          status?: string
          target_xp?: number
          winner_id?: string | null
        }
        Update: {
          challenge_type?: string
          challenged_id?: string
          challenged_progress?: number
          challenger_id?: string
          challenger_progress?: number
          completed_at?: string | null
          created_at?: string
          duration_days?: number
          expires_at?: string
          id?: string
          status?: string
          target_xp?: number
          winner_id?: string | null
        }
        Relationships: []
      }
      client_errors: {
        Row: {
          created_at: string
          function_name: string | null
          id: string
          message: string
          meta: Json
          route: string | null
          source: string
          stack: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          function_name?: string | null
          id?: string
          message: string
          meta?: Json
          route?: string | null
          source?: string
          stack?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          function_name?: string | null
          id?: string
          message?: string
          meta?: Json
          route?: string | null
          source?: string
          stack?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      content_concept_links: {
        Row: {
          concept_id: string
          content_id: string
          content_type: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["concept_role"]
        }
        Insert: {
          concept_id: string
          content_id: string
          content_type: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["concept_role"]
        }
        Update: {
          concept_id?: string
          content_id?: string
          content_type?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["concept_role"]
        }
        Relationships: [
          {
            foreignKeyName: "content_concept_links_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "curriculum_concepts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_embeddings: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          dialect: string
          embedding: string
          id: string
          kind: string
          source_id: string
        }
        Insert: {
          chunk_index?: number
          content: string
          created_at?: string
          dialect: string
          embedding: string
          id?: string
          kind: string
          source_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          dialect?: string
          embedding?: string
          id?: string
          kind?: string
          source_id?: string
        }
        Relationships: []
      }
      content_import_logs: {
        Row: {
          created_at: string
          id: string
          platform: string
          url: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          platform?: string
          url: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          platform?: string
          url?: string
          user_id?: string | null
        }
        Relationships: []
      }
      content_requests: {
        Row: {
          body: string
          created_at: string
          id: string
          request_type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          request_type?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          request_type?: string
          user_id?: string
        }
        Relationships: []
      }
      conversation_scenarios: {
        Row: {
          created_at: string
          created_by: string
          description: string
          dialect: string
          difficulty: string
          example_exchanges: Json
          icon_name: string
          id: string
          session_id: string | null
          status: string
          system_prompt: string
          title: string
          title_arabic: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string
          dialect?: string
          difficulty?: string
          example_exchanges?: Json
          icon_name?: string
          id?: string
          session_id?: string | null
          status?: string
          system_prompt?: string
          title?: string
          title_arabic?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string
          dialect?: string
          difficulty?: string
          example_exchanges?: Json
          icon_name?: string
          id?: string
          session_id?: string | null
          status?: string
          system_prompt?: string
          title?: string
          title_arabic?: string
          updated_at?: string
        }
        Relationships: []
      }
      curriculum_chat_approvals: {
        Row: {
          approval_type: string
          approved_by: string
          created_at: string
          id: string
          message_id: string
          session_id: string
          target_lesson_id: string | null
        }
        Insert: {
          approval_type: string
          approved_by: string
          created_at?: string
          id?: string
          message_id: string
          session_id: string
          target_lesson_id?: string | null
        }
        Update: {
          approval_type?: string
          approved_by?: string
          created_at?: string
          id?: string
          message_id?: string
          session_id?: string
          target_lesson_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "curriculum_chat_approvals_target_lesson_id_fkey"
            columns: ["target_lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      curriculum_chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          llm_model: string | null
          output_type: string | null
          role: string
          session_id: string
          structured_output: Json | null
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          llm_model?: string | null
          output_type?: string | null
          role?: string
          session_id: string
          structured_output?: Json | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          llm_model?: string | null
          output_type?: string | null
          role?: string
          session_id?: string
          structured_output?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "curriculum_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "curriculum_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      curriculum_chat_sessions: {
        Row: {
          admin_id: string
          created_at: string
          id: string
          llm_model: string
          status: string
          target_cefr: string | null
          target_dialect: string
          target_stage_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          admin_id: string
          created_at?: string
          id?: string
          llm_model?: string
          status?: string
          target_cefr?: string | null
          target_dialect?: string
          target_stage_id?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          admin_id?: string
          created_at?: string
          id?: string
          llm_model?: string
          status?: string
          target_cefr?: string | null
          target_dialect?: string
          target_stage_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      curriculum_concepts: {
        Row: {
          cefr_level: string | null
          created_at: string
          dialect: string
          display_arabic: string | null
          display_english: string | null
          first_introduced_at: string
          id: string
          key: string
          kind: Database["public"]["Enums"]["concept_kind"]
          metadata: Json
          source_id: string | null
          source_type: string | null
          stage_id: string | null
          updated_at: string
        }
        Insert: {
          cefr_level?: string | null
          created_at?: string
          dialect?: string
          display_arabic?: string | null
          display_english?: string | null
          first_introduced_at?: string
          id?: string
          key: string
          kind: Database["public"]["Enums"]["concept_kind"]
          metadata?: Json
          source_id?: string | null
          source_type?: string | null
          stage_id?: string | null
          updated_at?: string
        }
        Update: {
          cefr_level?: string | null
          created_at?: string
          dialect?: string
          display_arabic?: string | null
          display_english?: string | null
          first_introduced_at?: string
          id?: string
          key?: string
          kind?: Database["public"]["Enums"]["concept_kind"]
          metadata?: Json
          source_id?: string | null
          source_type?: string | null
          stage_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      curriculum_generation_log: {
        Row: {
          cefr: string | null
          content_type: string | null
          created_at: string
          created_by: string | null
          dialect: string
          excluded_concepts: string[]
          id: string
          included_concepts: string[]
          model: string | null
          prompt_summary: string | null
          reinforced_concepts: string[]
          request_id: string | null
          stage_id: string | null
        }
        Insert: {
          cefr?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          dialect?: string
          excluded_concepts?: string[]
          id?: string
          included_concepts?: string[]
          model?: string | null
          prompt_summary?: string | null
          reinforced_concepts?: string[]
          request_id?: string | null
          stage_id?: string | null
        }
        Update: {
          cefr?: string | null
          content_type?: string | null
          created_at?: string
          created_by?: string | null
          dialect?: string
          excluded_concepts?: string[]
          id?: string
          included_concepts?: string[]
          model?: string | null
          prompt_summary?: string | null
          reinforced_concepts?: string[]
          request_id?: string | null
          stage_id?: string | null
        }
        Relationships: []
      }
      curriculum_stages: {
        Row: {
          cefr_level: string | null
          created_at: string
          description: string | null
          display_order: number
          id: string
          name: string
          name_arabic: string | null
          stage_number: number
          updated_at: string
        }
        Insert: {
          cefr_level?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          name: string
          name_arabic?: string | null
          stage_number: number
          updated_at?: string
        }
        Update: {
          cefr_level?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          name?: string
          name_arabic?: string | null
          stage_number?: number
          updated_at?: string
        }
        Relationships: []
      }
      daily_challenge_completions: {
        Row: {
          challenge_date: string
          challenge_type: string
          completed_at: string
          id: string
          max_score: number
          score: number
          user_id: string
          xp_earned: number
        }
        Insert: {
          challenge_date?: string
          challenge_type?: string
          completed_at?: string
          id?: string
          max_score?: number
          score?: number
          user_id: string
          xp_earned?: number
        }
        Update: {
          challenge_date?: string
          challenge_type?: string
          completed_at?: string
          id?: string
          max_score?: number
          score?: number
          user_id?: string
          xp_earned?: number
        }
        Relationships: []
      }
      daily_challenges: {
        Row: {
          challenge_date: string | null
          challenge_type: string
          created_at: string
          created_by: string
          dialect: string
          difficulty: string
          id: string
          questions: Json
          session_id: string | null
          status: string
          title: string
          title_arabic: string
          updated_at: string
        }
        Insert: {
          challenge_date?: string | null
          challenge_type?: string
          created_at?: string
          created_by: string
          dialect?: string
          difficulty?: string
          id?: string
          questions?: Json
          session_id?: string | null
          status?: string
          title?: string
          title_arabic?: string
          updated_at?: string
        }
        Update: {
          challenge_date?: string | null
          challenge_type?: string
          created_at?: string
          created_by?: string
          dialect?: string
          difficulty?: string
          id?: string
          questions?: Json
          session_id?: string | null
          status?: string
          title?: string
          title_arabic?: string
          updated_at?: string
        }
        Relationships: []
      }
      daily_new_card_counts: {
        Row: {
          count: number
          created_at: string
          day: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          count?: number
          created_at?: string
          day?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          count?: number
          created_at?: string
          day?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_vocab_stories: {
        Row: {
          audio_url: string | null
          body_arabic: string
          body_english: string | null
          body_english_literal: string | null
          body_transliteration: string | null
          created_at: string
          dialect: string
          id: string
          new_words: Json
          sentences: Json | null
          story_date: string
          title: string
          updated_at: string
          user_id: string
          vocab_used: Json
        }
        Insert: {
          audio_url?: string | null
          body_arabic: string
          body_english?: string | null
          body_english_literal?: string | null
          body_transliteration?: string | null
          created_at?: string
          dialect?: string
          id?: string
          new_words?: Json
          sentences?: Json | null
          story_date?: string
          title: string
          updated_at?: string
          user_id: string
          vocab_used?: Json
        }
        Update: {
          audio_url?: string | null
          body_arabic?: string
          body_english?: string | null
          body_english_literal?: string | null
          body_transliteration?: string | null
          created_at?: string
          dialect?: string
          id?: string
          new_words?: Json
          sentences?: Json | null
          story_date?: string
          title?: string
          updated_at?: string
          user_id?: string
          vocab_used?: Json
        }
        Relationships: []
      }
      dialect_corpus_sentences: {
        Row: {
          created_at: string
          dialect: string
          id: string
          keyword_flagged: boolean
          license: string
          sort_key: number
          source: string
          text: string
          token_count: number | null
          vet_reason: string | null
          vetted: boolean | null
          vetted_at: string | null
        }
        Insert: {
          created_at?: string
          dialect: string
          id?: string
          keyword_flagged?: boolean
          license?: string
          sort_key?: number
          source?: string
          text: string
          token_count?: number | null
          vet_reason?: string | null
          vetted?: boolean | null
          vetted_at?: string | null
        }
        Update: {
          created_at?: string
          dialect?: string
          id?: string
          keyword_flagged?: boolean
          license?: string
          sort_key?: number
          source?: string
          text?: string
          token_count?: number | null
          vet_reason?: string | null
          vetted?: boolean | null
          vetted_at?: string | null
        }
        Relationships: []
      }
      dialect_native_reviews: {
        Row: {
          content_id: string | null
          content_type: string
          corrected_text: string | null
          created_at: string
          dialect: string
          id: string
          metadata: Json
          original_text: string
          reviewer_id: string | null
          reviewer_notes: string | null
          source: string
          source_function: string | null
          status: string
          updated_at: string
          violation_id: string | null
        }
        Insert: {
          content_id?: string | null
          content_type?: string
          corrected_text?: string | null
          created_at?: string
          dialect: string
          id?: string
          metadata?: Json
          original_text: string
          reviewer_id?: string | null
          reviewer_notes?: string | null
          source?: string
          source_function?: string | null
          status?: string
          updated_at?: string
          violation_id?: string | null
        }
        Update: {
          content_id?: string | null
          content_type?: string
          corrected_text?: string | null
          created_at?: string
          dialect?: string
          id?: string
          metadata?: Json
          original_text?: string
          reviewer_id?: string | null
          reviewer_notes?: string | null
          source?: string
          source_function?: string | null
          status?: string
          updated_at?: string
          violation_id?: string | null
        }
        Relationships: []
      }
      dialect_rule_violations: {
        Row: {
          created_at: string
          detected_by: string
          dialect: string
          id: string
          metadata: Json
          msa_token: string | null
          offending_text: string
          resolved: boolean
          rule_id: string | null
          source_function: string | null
          suggested_replacement: string | null
        }
        Insert: {
          created_at?: string
          detected_by?: string
          dialect: string
          id?: string
          metadata?: Json
          msa_token?: string | null
          offending_text: string
          resolved?: boolean
          rule_id?: string | null
          source_function?: string | null
          suggested_replacement?: string | null
        }
        Update: {
          created_at?: string
          detected_by?: string
          dialect?: string
          id?: string
          metadata?: Json
          msa_token?: string | null
          offending_text?: string
          resolved?: boolean
          rule_id?: string | null
          source_function?: string | null
          suggested_replacement?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dialect_rule_violations_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "dialect_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      dialect_rules: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          category: string
          created_at: string
          created_by: string | null
          dialect: string
          examples: Json
          id: string
          notes: string | null
          priority: number
          rule: string
          source: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          category: string
          created_at?: string
          created_by?: string | null
          dialect: string
          examples?: Json
          id?: string
          notes?: string | null
          priority?: number
          rule: string
          source?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          dialect?: string
          examples?: Json
          id?: string
          notes?: string | null
          priority?: number
          rule?: string
          source?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      discover_videos: {
        Row: {
          cefr_level: string | null
          created_at: string
          created_by: string
          cultural_context: string | null
          dialect: string
          difficulty: string
          difficulty_metrics: Json | null
          difficulty_rationale: string | null
          duration_seconds: number | null
          embed_url: string
          engines_used: Json | null
          grammar_points: Json
          id: string
          is_meme: boolean
          platform: string
          published: boolean
          source_url: string
          thumbnail_url: string | null
          title: string
          title_arabic: string | null
          transcript_lines: Json
          transcription_error: string | null
          transcription_status: string
          trending_candidate_id: string | null
          updated_at: string
          vocabulary: Json
        }
        Insert: {
          cefr_level?: string | null
          created_at?: string
          created_by: string
          cultural_context?: string | null
          dialect?: string
          difficulty?: string
          difficulty_metrics?: Json | null
          difficulty_rationale?: string | null
          duration_seconds?: number | null
          embed_url: string
          engines_used?: Json | null
          grammar_points?: Json
          id?: string
          is_meme?: boolean
          platform?: string
          published?: boolean
          source_url: string
          thumbnail_url?: string | null
          title: string
          title_arabic?: string | null
          transcript_lines?: Json
          transcription_error?: string | null
          transcription_status?: string
          trending_candidate_id?: string | null
          updated_at?: string
          vocabulary?: Json
        }
        Update: {
          cefr_level?: string | null
          created_at?: string
          created_by?: string
          cultural_context?: string | null
          dialect?: string
          difficulty?: string
          difficulty_metrics?: Json | null
          difficulty_rationale?: string | null
          duration_seconds?: number | null
          embed_url?: string
          engines_used?: Json | null
          grammar_points?: Json
          id?: string
          is_meme?: boolean
          platform?: string
          published?: boolean
          source_url?: string
          thumbnail_url?: string | null
          title?: string
          title_arabic?: string | null
          transcript_lines?: Json
          transcription_error?: string | null
          transcription_status?: string
          trending_candidate_id?: string | null
          updated_at?: string
          vocabulary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "discover_videos_trending_candidate_id_fkey"
            columns: ["trending_candidate_id"]
            isOneToOne: false
            referencedRelation: "trending_video_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          created_at: string
          dialect: string | null
          event: string
          feature: string
          id: string
          message: string
          meta: Json | null
          metric_id: string | null
          severity: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          created_at?: string
          dialect?: string | null
          event: string
          feature: string
          id?: string
          message: string
          meta?: Json | null
          metric_id?: string | null
          severity?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          created_at?: string
          dialect?: string | null
          event?: string
          feature?: string
          id?: string
          message?: string
          meta?: Json | null
          metric_id?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_alerts_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "feature_metrics"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_metrics: {
        Row: {
          count: number | null
          created_at: string
          dialect: string | null
          duration_ms: number | null
          event: string
          feature: string
          id: string
          meta: Json
          score: number | null
          status: string
          user_id: string | null
        }
        Insert: {
          count?: number | null
          created_at?: string
          dialect?: string | null
          duration_ms?: number | null
          event: string
          feature: string
          id?: string
          meta?: Json
          score?: number | null
          status?: string
          user_id?: string | null
        }
        Update: {
          count?: number | null
          created_at?: string
          dialect?: string | null
          duration_ms?: number | null
          event?: string
          feature?: string
          id?: string
          meta?: Json
          score?: number | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      grammar_exercises: {
        Row: {
          category: string
          choices: Json
          correct_index: number
          created_at: string
          created_by: string
          dialect: string
          difficulty: string
          explanation: string
          grammar_point: string
          id: string
          question_arabic: string
          question_english: string
          session_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          category?: string
          choices?: Json
          correct_index?: number
          created_at?: string
          created_by: string
          dialect?: string
          difficulty?: string
          explanation?: string
          grammar_point?: string
          id?: string
          question_arabic: string
          question_english: string
          session_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          choices?: Json
          correct_index?: number
          created_at?: string
          created_by?: string
          dialect?: string
          difficulty?: string
          explanation?: string
          grammar_point?: string
          id?: string
          question_arabic?: string
          question_english?: string
          session_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      human_review_requests: {
        Row: {
          admin_response: string | null
          ai_response: string
          conversation_context: string
          created_at: string
          id: string
          status: string
          user_id: string
        }
        Insert: {
          admin_response?: string | null
          ai_response: string
          conversation_context: string
          created_at?: string
          id?: string
          status?: string
          user_id: string
        }
        Update: {
          admin_response?: string | null
          ai_response?: string
          conversation_context?: string
          created_at?: string
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      institutions: {
        Row: {
          created_at: string
          id: string
          institution_type: string
          logo_url: string | null
          name: string
          name_arabic: string | null
          updated_at: string
          verified: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          institution_type?: string
          logo_url?: string | null
          name: string
          name_arabic?: string | null
          updated_at?: string
          verified?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          institution_type?: string
          logo_url?: string | null
          name?: string
          name_arabic?: string | null
          updated_at?: string
          verified?: boolean
        }
        Relationships: []
      }
      interactive_stories: {
        Row: {
          cover_image_url: string | null
          created_at: string
          created_by: string
          description: string
          description_arabic: string
          dialect: string
          difficulty: string
          display_order: number
          icon_name: string
          id: string
          session_id: string | null
          status: string
          title: string
          title_arabic: string
          updated_at: string
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          created_by: string
          description?: string
          description_arabic?: string
          dialect?: string
          difficulty?: string
          display_order?: number
          icon_name?: string
          id?: string
          session_id?: string | null
          status?: string
          title?: string
          title_arabic?: string
          updated_at?: string
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          created_by?: string
          description?: string
          description_arabic?: string
          dialect?: string
          difficulty?: string
          display_order?: number
          icon_name?: string
          id?: string
          session_id?: string | null
          status?: string
          title?: string
          title_arabic?: string
          updated_at?: string
        }
        Relationships: []
      }
      invite_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          max_uses: number
          note: string | null
          updated_at: string
          uses: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number
          note?: string | null
          updated_at?: string
          uses?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number
          note?: string | null
          updated_at?: string
          uses?: number
        }
        Relationships: []
      }
      invite_redemptions: {
        Row: {
          id: string
          invite_code_id: string
          redeemed_at: string
          user_id: string
        }
        Insert: {
          id?: string
          invite_code_id: string
          redeemed_at?: string
          user_id: string
        }
        Update: {
          id?: string
          invite_code_id?: string
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_redemptions_invite_code_id_fkey"
            columns: ["invite_code_id"]
            isOneToOne: false
            referencedRelation: "invite_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      learner_errors: {
        Row: {
          created_at: string
          detail: Json
          dialect: string
          error_kind: string
          id: string
          produced_arabic: string | null
          resolved_at: string | null
          source: string
          target_arabic: string
          user_id: string
          user_vocabulary_id: string | null
          word_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json
          dialect?: string
          error_kind?: string
          id?: string
          produced_arabic?: string | null
          resolved_at?: string | null
          source: string
          target_arabic: string
          user_id: string
          user_vocabulary_id?: string | null
          word_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json
          dialect?: string
          error_kind?: string
          id?: string
          produced_arabic?: string | null
          resolved_at?: string | null
          source?: string
          target_arabic?: string
          user_id?: string
          user_vocabulary_id?: string | null
          word_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "learner_errors_user_vocabulary_id_fkey"
            columns: ["user_vocabulary_id"]
            isOneToOne: false
            referencedRelation: "user_vocabulary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learner_errors_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_words"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_paths: {
        Row: {
          completed_at: string | null
          created_at: string
          current_week: number
          curriculum: Json
          goal_description: string
          goal_type: string
          id: string
          last_activity_at: string | null
          started_at: string
          status: string
          target_dialect: string
          target_level: string
          timeline_weeks: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_week?: number
          curriculum?: Json
          goal_description?: string
          goal_type?: string
          id?: string
          last_activity_at?: string | null
          started_at?: string
          status?: string
          target_dialect?: string
          target_level?: string
          timeline_weeks?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_week?: number
          curriculum?: Json
          goal_description?: string
          goal_type?: string
          id?: string
          last_activity_at?: string | null
          started_at?: string
          status?: string
          target_dialect?: string
          target_level?: string
          timeline_weeks?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lesson_progress: {
        Row: {
          best_score: number | null
          completed_at: string | null
          id: string
          last_word_index: number
          lesson_id: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
          words_seen: number
          words_total: number
        }
        Insert: {
          best_score?: number | null
          completed_at?: string | null
          id?: string
          last_word_index?: number
          lesson_id: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
          words_seen?: number
          words_total?: number
        }
        Update: {
          best_score?: number | null
          completed_at?: string | null
          id?: string
          last_word_index?: number
          lesson_id?: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
          words_seen?: number
          words_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "lesson_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          approach: string | null
          cefr_target: string | null
          created_at: string
          description: string | null
          dialect_module: string
          display_order: number
          duration_minutes: number | null
          gradient: string
          icon: string
          id: string
          lesson_number: number
          stage_id: string
          status: string
          title: string
          title_arabic: string | null
          updated_at: string
        }
        Insert: {
          approach?: string | null
          cefr_target?: string | null
          created_at?: string
          description?: string | null
          dialect_module?: string
          display_order?: number
          duration_minutes?: number | null
          gradient?: string
          icon?: string
          id?: string
          lesson_number?: number
          stage_id: string
          status?: string
          title: string
          title_arabic?: string | null
          updated_at?: string
        }
        Update: {
          approach?: string | null
          cefr_target?: string | null
          created_at?: string
          description?: string | null
          dialect_module?: string
          display_order?: number
          duration_minutes?: number | null
          gradient?: string
          icon?: string
          id?: string
          lesson_number?: number
          stage_id?: string
          status?: string
          title?: string
          title_arabic?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "curriculum_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      listen_episode_plays: {
        Row: {
          completed: boolean
          created_at: string
          episode_id: string
          id: string
          last_line_index: number
          last_position_seconds: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          episode_id: string
          id?: string
          last_line_index?: number
          last_position_seconds?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          episode_id?: string
          id?: string
          last_line_index?: number
          last_position_seconds?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listen_episode_plays_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "listen_episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      listen_episodes: {
        Row: {
          audio_mode: string
          audio_status: string
          created_at: string
          creator_id: string
          dialect: string
          duration_seconds: number | null
          format: string
          full_audio_url: string | null
          id: string
          key_vocabulary: Json
          length_bucket: string
          line_durations: Json | null
          play_count: number
          script: Json
          summary: string | null
          title: string
          topic: string
          topic_category: string | null
          updated_at: string
        }
        Insert: {
          audio_mode?: string
          audio_status?: string
          created_at?: string
          creator_id: string
          dialect: string
          duration_seconds?: number | null
          format: string
          full_audio_url?: string | null
          id?: string
          key_vocabulary?: Json
          length_bucket: string
          line_durations?: Json | null
          play_count?: number
          script?: Json
          summary?: string | null
          title: string
          topic: string
          topic_category?: string | null
          updated_at?: string
        }
        Update: {
          audio_mode?: string
          audio_status?: string
          created_at?: string
          creator_id?: string
          dialect?: string
          duration_seconds?: number | null
          format?: string
          full_audio_url?: string | null
          id?: string
          key_vocabulary?: Json
          length_bucket?: string
          line_durations?: Json | null
          play_count?: number
          script?: Json
          summary?: string | null
          title?: string
          topic?: string
          topic_category?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      listen_line_audio: {
        Row: {
          audio_url: string
          created_at: string
          duration_seconds: number | null
          episode_id: string
          id: string
          line_index: number
          speaker: string | null
        }
        Insert: {
          audio_url: string
          created_at?: string
          duration_seconds?: number | null
          episode_id: string
          id?: string
          line_index: number
          speaker?: string | null
        }
        Update: {
          audio_url?: string
          created_at?: string
          duration_seconds?: number | null
          episode_id?: string
          id?: string
          line_index?: number
          speaker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listen_line_audio_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "listen_episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      listening_exercises: {
        Row: {
          audio_text: string
          audio_text_english: string
          created_at: string
          created_by: string
          dialect: string
          difficulty: string
          hint: string | null
          id: string
          mode: string
          questions: Json
          session_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          audio_text?: string
          audio_text_english?: string
          created_at?: string
          created_by: string
          dialect?: string
          difficulty?: string
          hint?: string | null
          id?: string
          mode?: string
          questions?: Json
          session_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          audio_text?: string
          audio_text_english?: string
          created_at?: string
          created_by?: string
          dialect?: string
          difficulty?: string
          hint?: string | null
          id?: string
          mode?: string
          questions?: Json
          session_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      llm_usage_logs: {
        Row: {
          cached_tokens: number | null
          completion_tokens: number | null
          cost_usd: number | null
          created_at: string
          function_name: string
          id: string
          llm_used: string
          phrase: string | null
          prompt_tokens: number | null
          provider: string | null
          unit_kind: string | null
          units: number | null
          user_id: string | null
        }
        Insert: {
          cached_tokens?: number | null
          completion_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          function_name: string
          id?: string
          llm_used: string
          phrase?: string | null
          prompt_tokens?: number | null
          provider?: string | null
          unit_kind?: string | null
          units?: number | null
          user_id?: string | null
        }
        Update: {
          cached_tokens?: number | null
          completion_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          function_name?: string
          id?: string
          llm_used?: string
          phrase?: string | null
          prompt_tokens?: number | null
          provider?: string | null
          unit_kind?: string | null
          units?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      meme_posts: {
        Row: {
          audio_lines: Json
          audio_skipped_reason: string | null
          created_at: string
          created_by: string
          dialect: string
          difficulty: string
          grammar_points: Json
          has_music: boolean
          has_speech: boolean
          id: string
          media_type: string
          media_url: string
          meme_explanation: Json
          on_screen_text: Json
          published_at: string | null
          source_url: string | null
          status: string
          tags: string[]
          thumbnail_url: string | null
          title: string
          title_arabic: string
          updated_at: string
          vocabulary: Json
        }
        Insert: {
          audio_lines?: Json
          audio_skipped_reason?: string | null
          created_at?: string
          created_by: string
          dialect?: string
          difficulty?: string
          grammar_points?: Json
          has_music?: boolean
          has_speech?: boolean
          id?: string
          media_type?: string
          media_url: string
          meme_explanation?: Json
          on_screen_text?: Json
          published_at?: string | null
          source_url?: string | null
          status?: string
          tags?: string[]
          thumbnail_url?: string | null
          title?: string
          title_arabic?: string
          updated_at?: string
          vocabulary?: Json
        }
        Update: {
          audio_lines?: Json
          audio_skipped_reason?: string | null
          created_at?: string
          created_by?: string
          dialect?: string
          difficulty?: string
          grammar_points?: Json
          has_music?: boolean
          has_speech?: boolean
          id?: string
          media_type?: string
          media_url?: string
          meme_explanation?: Json
          on_screen_text?: Json
          published_at?: string | null
          source_url?: string | null
          status?: string
          tags?: string[]
          thumbnail_url?: string | null
          title?: string
          title_arabic?: string
          updated_at?: string
          vocabulary?: Json
        }
        Relationships: []
      }
      msa_transformation_rules: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          dialect: string
          dialect_pattern: string
          display_order: number
          example_audio_url: string | null
          example_dialect: string | null
          example_msa: string | null
          id: string
          msa_pattern: string
          notes: string | null
          rule_name: string
          status: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          dialect?: string
          dialect_pattern: string
          display_order?: number
          example_audio_url?: string | null
          example_dialect?: string | null
          example_msa?: string | null
          id?: string
          msa_pattern: string
          notes?: string | null
          rule_name: string
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          dialect?: string
          dialect_pattern?: string
          display_order?: number
          example_audio_url?: string | null
          example_dialect?: string | null
          example_msa?: string | null
          id?: string
          msa_pattern?: string
          notes?: string | null
          rule_name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      native_feedback_credits: {
        Row: {
          created_at: string
          delta: number
          id: string
          reason: string
          stripe_session_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          delta: number
          id?: string
          reason: string
          stripe_session_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          delta?: number
          id?: string
          reason?: string
          stripe_session_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      native_feedback_requests: {
        Row: {
          answered_at: string | null
          created_at: string
          dialect: string
          id: string
          kind: string
          response_text: string | null
          review_id: string | null
          reviewer_notes: string | null
          status: string
          text: string
          user_id: string
        }
        Insert: {
          answered_at?: string | null
          created_at?: string
          dialect: string
          id?: string
          kind?: string
          response_text?: string | null
          review_id?: string | null
          reviewer_notes?: string | null
          status?: string
          text: string
          user_id: string
        }
        Update: {
          answered_at?: string | null
          created_at?: string
          dialect?: string
          id?: string
          kind?: string
          response_text?: string | null
          review_id?: string | null
          reviewer_notes?: string | null
          status?: string
          text?: string
          user_id?: string
        }
        Relationships: []
      }
      picture_scene_hotspots: {
        Row: {
          created_at: string
          display_order: number
          id: string
          radius_pct: number
          root: string | null
          scene_id: string
          updated_at: string
          word_arabic: string
          word_audio_url: string | null
          word_english: string
          x_pct: number | null
          y_pct: number | null
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          radius_pct?: number
          root?: string | null
          scene_id: string
          updated_at?: string
          word_arabic: string
          word_audio_url?: string | null
          word_english?: string
          x_pct?: number | null
          y_pct?: number | null
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          radius_pct?: number
          root?: string | null
          scene_id?: string
          updated_at?: string
          word_arabic?: string
          word_audio_url?: string | null
          word_english?: string
          x_pct?: number | null
          y_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "picture_scene_hotspots_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "picture_scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      picture_scenes: {
        Row: {
          cefr_level: string | null
          created_at: string
          created_by: string
          description: string | null
          dialect: string
          display_order: number
          id: string
          image_url: string | null
          session_id: string | null
          status: string
          theme: string
          title: string
          title_arabic: string
          updated_at: string
        }
        Insert: {
          cefr_level?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          dialect?: string
          display_order?: number
          id?: string
          image_url?: string | null
          session_id?: string | null
          status?: string
          theme?: string
          title?: string
          title_arabic?: string
          updated_at?: string
        }
        Update: {
          cefr_level?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          dialect?: string
          display_order?: number
          id?: string
          image_url?: string | null
          session_id?: string | null
          status?: string
          theme?: string
          title?: string
          title_arabic?: string
          updated_at?: string
        }
        Relationships: []
      }
      placement_history: {
        Row: {
          cefr_level: string
          confidence: number | null
          dialect: string
          id: string
          taken_at: string
          user_id: string
        }
        Insert: {
          cefr_level: string
          confidence?: number | null
          dialect: string
          id?: string
          taken_at?: string
          user_id: string
        }
        Update: {
          cefr_level?: string
          confidence?: number | null
          dialect?: string
          id?: string
          taken_at?: string
          user_id?: string
        }
        Relationships: []
      }
      processed_videos: {
        Row: {
          content_hash: string
          created_at: string
          dialect: string | null
          duration_seconds: number | null
          id: string
          original_url: string
          platform: string
          processed_at: string
          processing_engines: string[] | null
          source_language: string | null
          transcription_data: Json
          updated_at: string
          video_id: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          dialect?: string | null
          duration_seconds?: number | null
          id?: string
          original_url: string
          platform: string
          processed_at?: string
          processing_engines?: string[] | null
          source_language?: string | null
          transcription_data?: Json
          updated_at?: string
          video_id: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          dialect?: string | null
          duration_seconds?: number | null
          id?: string
          original_url?: string
          platform?: string
          processed_at?: string
          processing_engines?: string[] | null
          source_language?: string | null
          transcription_data?: Json
          updated_at?: string
          video_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bridge_view_enabled: boolean
          contribute_audio: boolean
          created_at: string
          custom_institution: string | null
          desired_retention: number | null
          display_name: string | null
          id: string
          institution_id: string | null
          interests: string[]
          invited_via: string | null
          learning_reason: string | null
          msa_background: string | null
          onboarding_completed: boolean
          placement_level: string | null
          placement_level_egyptian: string | null
          placement_level_gulf: string | null
          placement_level_yemeni: string | null
          placement_taken_at: string | null
          placement_taken_at_egyptian: string | null
          placement_taken_at_gulf: string | null
          placement_taken_at_yemeni: string | null
          preferred_dialect: string | null
          proficiency_level: string | null
          show_institution: boolean
          show_on_leaderboard: boolean
          updated_at: string
          user_id: string
          weekly_goal: string | null
        }
        Insert: {
          avatar_url?: string | null
          bridge_view_enabled?: boolean
          contribute_audio?: boolean
          created_at?: string
          custom_institution?: string | null
          desired_retention?: number | null
          display_name?: string | null
          id?: string
          institution_id?: string | null
          interests?: string[]
          invited_via?: string | null
          learning_reason?: string | null
          msa_background?: string | null
          onboarding_completed?: boolean
          placement_level?: string | null
          placement_level_egyptian?: string | null
          placement_level_gulf?: string | null
          placement_level_yemeni?: string | null
          placement_taken_at?: string | null
          placement_taken_at_egyptian?: string | null
          placement_taken_at_gulf?: string | null
          placement_taken_at_yemeni?: string | null
          preferred_dialect?: string | null
          proficiency_level?: string | null
          show_institution?: boolean
          show_on_leaderboard?: boolean
          updated_at?: string
          user_id: string
          weekly_goal?: string | null
        }
        Update: {
          avatar_url?: string | null
          bridge_view_enabled?: boolean
          contribute_audio?: boolean
          created_at?: string
          custom_institution?: string | null
          desired_retention?: number | null
          display_name?: string | null
          id?: string
          institution_id?: string | null
          interests?: string[]
          invited_via?: string | null
          learning_reason?: string | null
          msa_background?: string | null
          onboarding_completed?: boolean
          placement_level?: string | null
          placement_level_egyptian?: string | null
          placement_level_gulf?: string | null
          placement_level_yemeni?: string | null
          placement_taken_at?: string | null
          placement_taken_at_egyptian?: string | null
          placement_taken_at_gulf?: string | null
          placement_taken_at_yemeni?: string | null
          preferred_dialect?: string | null
          proficiency_level?: string | null
          show_institution?: boolean
          show_on_leaderboard?: boolean
          updated_at?: string
          user_id?: string
          weekly_goal?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          disabled_at: string | null
          endpoint: string
          id: string
          last_sent_at: string | null
          p256dh: string
          timezone: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          disabled_at?: string | null
          endpoint: string
          id?: string
          last_sent_at?: string | null
          p256dh: string
          timezone?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          disabled_at?: string | null
          endpoint?: string
          id?: string
          last_sent_at?: string | null
          p256dh?: string
          timezone?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reading_passages: {
        Row: {
          created_at: string
          created_by: string
          cultural_note: string | null
          dialect: string
          difficulty: string
          id: string
          passage: string
          passage_english: string
          questions: Json
          session_id: string | null
          status: string
          title: string
          title_english: string
          updated_at: string
          vocabulary: Json
        }
        Insert: {
          created_at?: string
          created_by: string
          cultural_note?: string | null
          dialect?: string
          difficulty?: string
          id?: string
          passage?: string
          passage_english?: string
          questions?: Json
          session_id?: string | null
          status?: string
          title?: string
          title_english?: string
          updated_at?: string
          vocabulary?: Json
        }
        Update: {
          created_at?: string
          created_by?: string
          cultural_note?: string | null
          dialect?: string
          difficulty?: string
          id?: string
          passage?: string
          passage_english?: string
          questions?: Json
          session_id?: string | null
          status?: string
          title?: string
          title_english?: string
          updated_at?: string
          vocabulary?: Json
        }
        Relationships: []
      }
      referral_codes: {
        Row: {
          code: string
          created_at: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      referral_redemptions: {
        Row: {
          converted_at: string | null
          created_at: string
          id: string
          referred_user_id: string
          referrer_id: string
          rewarded_at: string | null
          status: string
        }
        Insert: {
          converted_at?: string | null
          created_at?: string
          id?: string
          referred_user_id: string
          referrer_id: string
          rewarded_at?: string | null
          status?: string
        }
        Update: {
          converted_at?: string | null
          created_at?: string
          id?: string
          referred_user_id?: string
          referrer_id?: string
          rewarded_at?: string | null
          status?: string
        }
        Relationships: []
      }
      review_streaks: {
        Row: {
          created_at: string
          current_streak: number
          id: string
          last_review_date: string | null
          longest_streak: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_streak?: number
          id?: string
          last_review_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_streak?: number
          id?: string
          last_review_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_chat_conversations: {
        Row: {
          created_at: string
          dialect: string
          id: string
          messages: Json
          page_context: Json | null
          seed: Json | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dialect: string
          id?: string
          messages: Json
          page_context?: Json | null
          seed?: Json | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dialect?: string
          id?: string
          messages?: Json
          page_context?: Json | null
          seed?: Json | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_text_translations: {
        Row: {
          created_at: string
          detected_dialect: string | null
          id: string
          sentences: Json
          source_dialect: string | null
          source_text: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          detected_dialect?: string | null
          id?: string
          sentences?: Json
          source_dialect?: string | null
          source_text: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          detected_dialect?: string | null
          id?: string
          sentences?: Json
          source_dialect?: string | null
          source_text?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_transcriptions: {
        Row: {
          audio_url: string | null
          created_at: string
          cultural_context: string | null
          dialect: string | null
          engines_used: Json | null
          grammar_points: Json
          id: string
          lines: Json
          raw_transcript_arabic: string
          title: string
          updated_at: string
          user_id: string
          vocabulary: Json
        }
        Insert: {
          audio_url?: string | null
          created_at?: string
          cultural_context?: string | null
          dialect?: string | null
          engines_used?: Json | null
          grammar_points?: Json
          id?: string
          lines?: Json
          raw_transcript_arabic: string
          title: string
          updated_at?: string
          user_id: string
          vocabulary?: Json
        }
        Update: {
          audio_url?: string | null
          created_at?: string
          cultural_context?: string | null
          dialect?: string | null
          engines_used?: Json | null
          grammar_points?: Json
          id?: string
          lines?: Json
          raw_transcript_arabic?: string
          title?: string
          updated_at?: string
          user_id?: string
          vocabulary?: Json
        }
        Relationships: []
      }
      set_phrase_occasions: {
        Row: {
          created_at: string
          description: string | null
          dialect: string
          difficulty_floor: string
          display_order: number
          icon_name: string
          id: string
          name: string
          name_arabic: string | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          dialect?: string
          difficulty_floor?: string
          display_order?: number
          icon_name?: string
          id?: string
          name: string
          name_arabic?: string | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          dialect?: string
          difficulty_floor?: string
          display_order?: number
          icon_name?: string
          id?: string
          name?: string
          name_arabic?: string | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      set_phrase_quiz_attempts: {
        Row: {
          answer_mode: string
          asr_similarity: number | null
          asr_transcript: string | null
          correct: boolean
          created_at: string
          id: string
          phrase_id: string
          question_type: string
          user_id: string
        }
        Insert: {
          answer_mode: string
          asr_similarity?: number | null
          asr_transcript?: string | null
          correct?: boolean
          created_at?: string
          id?: string
          phrase_id: string
          question_type: string
          user_id: string
        }
        Update: {
          answer_mode?: string
          asr_similarity?: number | null
          asr_transcript?: string | null
          correct?: boolean
          created_at?: string
          id?: string
          phrase_id?: string
          question_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "set_phrase_quiz_attempts_phrase_id_fkey"
            columns: ["phrase_id"]
            isOneToOne: false
            referencedRelation: "set_phrases"
            referencedColumns: ["id"]
          },
        ]
      }
      set_phrases: {
        Row: {
          accepted_variants: Json
          cached_distractors: Json
          created_at: string
          created_by: string | null
          cultural_note: string | null
          dialect: string
          difficulty: string
          formality: string
          id: string
          occasion_id: string | null
          phrase_arabic: string
          phrase_audio_url: string | null
          phrase_english: string | null
          phrase_literal: string | null
          phrase_transliteration: string | null
          reply_arabic: string | null
          reply_audio_url: string | null
          reply_english: string | null
          reply_literal: string | null
          reply_transliteration: string | null
          scenario_english: string | null
          status: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          accepted_variants?: Json
          cached_distractors?: Json
          created_at?: string
          created_by?: string | null
          cultural_note?: string | null
          dialect?: string
          difficulty?: string
          formality?: string
          id?: string
          occasion_id?: string | null
          phrase_arabic: string
          phrase_audio_url?: string | null
          phrase_english?: string | null
          phrase_literal?: string | null
          phrase_transliteration?: string | null
          reply_arabic?: string | null
          reply_audio_url?: string | null
          reply_english?: string | null
          reply_literal?: string | null
          reply_transliteration?: string | null
          scenario_english?: string | null
          status?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          accepted_variants?: Json
          cached_distractors?: Json
          created_at?: string
          created_by?: string | null
          cultural_note?: string | null
          dialect?: string
          difficulty?: string
          formality?: string
          id?: string
          occasion_id?: string | null
          phrase_arabic?: string
          phrase_audio_url?: string | null
          phrase_english?: string | null
          phrase_literal?: string | null
          phrase_transliteration?: string | null
          reply_arabic?: string | null
          reply_audio_url?: string | null
          reply_english?: string | null
          reply_literal?: string | null
          reply_transliteration?: string | null
          scenario_english?: string | null
          status?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "set_phrases_occasion_id_fkey"
            columns: ["occasion_id"]
            isOneToOne: false
            referencedRelation: "set_phrase_occasions"
            referencedColumns: ["id"]
          },
        ]
      }
      story_progress: {
        Row: {
          completed: boolean
          completed_at: string | null
          current_scene_id: string | null
          id: string
          path_taken: Json
          started_at: string
          story_id: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          current_scene_id?: string | null
          id?: string
          path_taken?: Json
          started_at?: string
          story_id: string
          user_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          current_scene_id?: string | null
          id?: string
          path_taken?: Json
          started_at?: string
          story_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_progress_current_scene_id_fkey"
            columns: ["current_scene_id"]
            isOneToOne: false
            referencedRelation: "story_scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_progress_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "interactive_stories"
            referencedColumns: ["id"]
          },
        ]
      }
      story_scenes: {
        Row: {
          choices: Json
          created_at: string
          ending_message: string | null
          ending_message_arabic: string | null
          id: string
          is_ending: boolean
          narrative_arabic: string
          narrative_english: string
          narrative_literal: string | null
          scene_order: number
          story_id: string
          updated_at: string
          vocabulary: Json
        }
        Insert: {
          choices?: Json
          created_at?: string
          ending_message?: string | null
          ending_message_arabic?: string | null
          id?: string
          is_ending?: boolean
          narrative_arabic?: string
          narrative_english?: string
          narrative_literal?: string | null
          scene_order?: number
          story_id: string
          updated_at?: string
          vocabulary?: Json
        }
        Update: {
          choices?: Json
          created_at?: string
          ending_message?: string | null
          ending_message_arabic?: string | null
          id?: string
          is_ending?: boolean
          narrative_arabic?: string
          narrative_english?: string
          narrative_literal?: string | null
          scene_order?: number
          story_id?: string
          updated_at?: string
          vocabulary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "story_scenes_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "interactive_stories"
            referencedColumns: ["id"]
          },
        ]
      }
      subscribers: {
        Row: {
          created_at: string
          email: string
          id: string
          stripe_customer_id: string | null
          subscribed: boolean
          subscription_end: string | null
          subscription_tier: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          stripe_customer_id?: string | null
          subscribed?: boolean
          subscription_end?: string | null
          subscription_tier?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          stripe_customer_id?: string | null
          subscribed?: boolean
          subscription_end?: string | null
          subscription_tier?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      topics: {
        Row: {
          created_at: string
          dialect_module: string
          display_order: number
          gradient: string
          icon: string
          id: string
          name: string
          name_arabic: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dialect_module?: string
          display_order?: number
          gradient?: string
          icon?: string
          id?: string
          name: string
          name_arabic: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dialect_module?: string
          display_order?: number
          gradient?: string
          icon?: string
          id?: string
          name?: string
          name_arabic?: string
          updated_at?: string
        }
        Relationships: []
      }
      training_examples: {
        Row: {
          audio_bucket: string | null
          audio_end_ms: number | null
          audio_path: string | null
          audio_start_ms: number | null
          context: Json
          corrector_id: string | null
          corrector_role: string
          created_at: string
          dialect: string
          engines: Json | null
          export_batch_id: string | null
          human_output: string
          id: string
          machine_output: string
          pii_reviewed: boolean
          source_function: string | null
          source_id: string | null
          source_license: string
          source_table: string
          task_type: string
          tier: string
        }
        Insert: {
          audio_bucket?: string | null
          audio_end_ms?: number | null
          audio_path?: string | null
          audio_start_ms?: number | null
          context?: Json
          corrector_id?: string | null
          corrector_role: string
          created_at?: string
          dialect: string
          engines?: Json | null
          export_batch_id?: string | null
          human_output: string
          id?: string
          machine_output: string
          pii_reviewed?: boolean
          source_function?: string | null
          source_id?: string | null
          source_license?: string
          source_table: string
          task_type: string
          tier: string
        }
        Update: {
          audio_bucket?: string | null
          audio_end_ms?: number | null
          audio_path?: string | null
          audio_start_ms?: number | null
          context?: Json
          corrector_id?: string | null
          corrector_role?: string
          created_at?: string
          dialect?: string
          engines?: Json | null
          export_batch_id?: string | null
          human_output?: string
          id?: string
          machine_output?: string
          pii_reviewed?: boolean
          source_function?: string | null
          source_id?: string | null
          source_license?: string
          source_table?: string
          task_type?: string
          tier?: string
        }
        Relationships: []
      }
      trending_video_candidates: {
        Row: {
          created_at: string | null
          creator_handle: string | null
          creator_name: string
          detected_topic: string | null
          discovered_at: string | null
          dismissed: boolean | null
          duration_seconds: number | null
          id: string
          platform: string
          processed: boolean | null
          region_code: string | null
          rejected: boolean | null
          rejection_reason: string | null
          thumbnail_url: string | null
          title: string
          trending_score: number | null
          updated_at: string | null
          url: string
          video_id: string
          view_count: number | null
        }
        Insert: {
          created_at?: string | null
          creator_handle?: string | null
          creator_name: string
          detected_topic?: string | null
          discovered_at?: string | null
          dismissed?: boolean | null
          duration_seconds?: number | null
          id?: string
          platform: string
          processed?: boolean | null
          region_code?: string | null
          rejected?: boolean | null
          rejection_reason?: string | null
          thumbnail_url?: string | null
          title: string
          trending_score?: number | null
          updated_at?: string | null
          url: string
          video_id: string
          view_count?: number | null
        }
        Update: {
          created_at?: string | null
          creator_handle?: string | null
          creator_name?: string
          detected_topic?: string | null
          discovered_at?: string | null
          dismissed?: boolean | null
          duration_seconds?: number | null
          id?: string
          platform?: string
          processed?: boolean | null
          region_code?: string | null
          rejected?: boolean | null
          rejection_reason?: string | null
          thumbnail_url?: string | null
          title?: string
          trending_score?: number | null
          updated_at?: string | null
          url?: string
          video_id?: string
          view_count?: number | null
        }
        Relationships: []
      }
      tutor_upload_candidates: {
        Row: {
          classification: string | null
          confidence: number | null
          created_at: string
          id: string
          image_url: string | null
          sentence_audio_url: string | null
          sentence_end_ms: number | null
          sentence_english: string | null
          sentence_start_ms: number | null
          sentence_text: string | null
          source_audio_url: string | null
          status: string
          upload_id: string
          user_id: string
          word_audio_url: string | null
          word_end_ms: number | null
          word_english: string | null
          word_standard: string | null
          word_start_ms: number | null
          word_text: string
        }
        Insert: {
          classification?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          sentence_audio_url?: string | null
          sentence_end_ms?: number | null
          sentence_english?: string | null
          sentence_start_ms?: number | null
          sentence_text?: string | null
          source_audio_url?: string | null
          status?: string
          upload_id: string
          user_id: string
          word_audio_url?: string | null
          word_end_ms?: number | null
          word_english?: string | null
          word_standard?: string | null
          word_start_ms?: number | null
          word_text: string
        }
        Update: {
          classification?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          sentence_audio_url?: string | null
          sentence_end_ms?: number | null
          sentence_english?: string | null
          sentence_start_ms?: number | null
          sentence_text?: string | null
          source_audio_url?: string | null
          status?: string
          upload_id?: string
          user_id?: string
          word_audio_url?: string | null
          word_end_ms?: number | null
          word_english?: string | null
          word_standard?: string | null
          word_start_ms?: number | null
          word_text?: string
        }
        Relationships: []
      }
      usage_counters: {
        Row: {
          count: number
          created_at: string
          day: string
          id: string
          key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          count?: number
          created_at?: string
          day?: string
          id?: string
          key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          count?: number
          created_at?: string
          day?: string
          id?: string
          key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_achievements: {
        Row: {
          achievement_id: string
          earned_at: string
          id: string
          user_id: string
        }
        Insert: {
          achievement_id: string
          earned_at?: string
          id?: string
          user_id: string
        }
        Update: {
          achievement_id?: string
          earned_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
        ]
      }
      user_checkpoint_progress: {
        Row: {
          checkpoint_index: number
          completed_at: string
          created_at: string
          id: string
          score: number
          user_id: string
        }
        Insert: {
          checkpoint_index: number
          completed_at?: string
          created_at?: string
          id?: string
          score?: number
          user_id: string
        }
        Update: {
          checkpoint_index?: number
          completed_at?: string
          created_at?: string
          id?: string
          score?: number
          user_id?: string
        }
        Relationships: []
      }
      user_concept_mastery: {
        Row: {
          concept_id: string
          correct: number
          created_at: string
          ease: number
          exposures: number
          incorrect: number
          last_seen_at: string | null
          next_due_at: string | null
          strength: Database["public"]["Enums"]["mastery_strength"]
          updated_at: string
          user_id: string
        }
        Insert: {
          concept_id: string
          correct?: number
          created_at?: string
          ease?: number
          exposures?: number
          incorrect?: number
          last_seen_at?: string | null
          next_due_at?: string | null
          strength?: Database["public"]["Enums"]["mastery_strength"]
          updated_at?: string
          user_id: string
        }
        Update: {
          concept_id?: string
          correct?: number
          created_at?: string
          ease?: number
          exposures?: number
          incorrect?: number
          last_seen_at?: string | null
          next_due_at?: string | null
          strength?: Database["public"]["Enums"]["mastery_strength"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_concept_mastery_concept_id_fkey"
            columns: ["concept_id"]
            isOneToOne: false
            referencedRelation: "curriculum_concepts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_difficulty: {
        Row: {
          id: string
          listening_difficulty: number
          listening_history: Json
          reading_difficulty: number
          reading_history: Json
          speaking_difficulty: number
          speaking_history: Json
          updated_at: string
          user_id: string
          vocab_difficulty: number
          vocab_history: Json
        }
        Insert: {
          id?: string
          listening_difficulty?: number
          listening_history?: Json
          reading_difficulty?: number
          reading_history?: Json
          speaking_difficulty?: number
          speaking_history?: Json
          updated_at?: string
          user_id: string
          vocab_difficulty?: number
          vocab_history?: Json
        }
        Update: {
          id?: string
          listening_difficulty?: number
          listening_history?: Json
          reading_difficulty?: number
          reading_history?: Json
          speaking_difficulty?: number
          speaking_history?: Json
          updated_at?: string
          user_id?: string
          vocab_difficulty?: number
          vocab_history?: Json
        }
        Relationships: []
      }
      user_follows: {
        Row: {
          created_at: string
          follower_id: string
          following_id: string
          id: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          following_id: string
          id?: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          following_id?: string
          id?: string
        }
        Relationships: []
      }
      user_letter_progress: {
        Row: {
          best_sound_score: number
          best_spot_score: number
          created_at: string
          id: string
          last_practiced_at: string
          letter_code: string
          mastered_at: string | null
          steps_completed: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          best_sound_score?: number
          best_spot_score?: number
          created_at?: string
          id?: string
          last_practiced_at?: string
          letter_code: string
          mastered_at?: string | null
          steps_completed?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          best_sound_score?: number
          best_spot_score?: number
          created_at?: string
          id?: string
          last_practiced_at?: string
          letter_code?: string
          mastered_at?: string | null
          steps_completed?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_phrases: {
        Row: {
          created_at: string
          dialect: string
          difficulty: number
          ease_factor: number
          id: string
          interval_days: number
          is_leech: boolean
          jingle_audio_url: string | null
          jingle_lyrics: string | null
          lapses: number
          last_reviewed_at: string | null
          mnemonic: string | null
          next_review_at: string
          notes: string | null
          phrase_arabic: string
          phrase_audio_url: string | null
          phrase_english: string
          repetitions: number
          source: string
          transliteration: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dialect?: string
          difficulty?: number
          ease_factor?: number
          id?: string
          interval_days?: number
          is_leech?: boolean
          jingle_audio_url?: string | null
          jingle_lyrics?: string | null
          lapses?: number
          last_reviewed_at?: string | null
          mnemonic?: string | null
          next_review_at?: string
          notes?: string | null
          phrase_arabic: string
          phrase_audio_url?: string | null
          phrase_english: string
          repetitions?: number
          source?: string
          transliteration?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dialect?: string
          difficulty?: number
          ease_factor?: number
          id?: string
          interval_days?: number
          is_leech?: boolean
          jingle_audio_url?: string | null
          jingle_lyrics?: string | null
          lapses?: number
          last_reviewed_at?: string | null
          mnemonic?: string | null
          next_review_at?: string
          notes?: string | null
          phrase_arabic?: string
          phrase_audio_url?: string | null
          phrase_english?: string
          repetitions?: number
          source?: string
          transliteration?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_picture_scene_progress: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          last_played_at: string
          last_score: number
          last_total: number
          scene_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          last_played_at?: string
          last_score?: number
          last_total?: number
          scene_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          last_played_at?: string
          last_score?: number
          last_total?: number
          scene_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_picture_scene_progress_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "picture_scenes"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_set_phrases: {
        Row: {
          created_at: string
          difficulty: number
          ease_factor: number
          id: string
          interval_days: number
          last_quality: number | null
          last_reviewed_at: string | null
          next_review_at: string
          phrase_id: string
          repetitions: number
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          difficulty?: number
          ease_factor?: number
          id?: string
          interval_days?: number
          last_quality?: number | null
          last_reviewed_at?: string | null
          next_review_at?: string
          phrase_id: string
          repetitions?: number
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          difficulty?: number
          ease_factor?: number
          id?: string
          interval_days?: number
          last_quality?: number | null
          last_reviewed_at?: string | null
          next_review_at?: string
          phrase_id?: string
          repetitions?: number
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_set_phrases_phrase_id_fkey"
            columns: ["phrase_id"]
            isOneToOne: false
            referencedRelation: "set_phrases"
            referencedColumns: ["id"]
          },
        ]
      }
      user_vocabulary: {
        Row: {
          anki_card_id: number | null
          anki_note_id: number | null
          correct_count: number
          created_at: string
          deck_name: string | null
          dialect: string
          difficulty: number
          ease_factor: number
          id: string
          image_url: string | null
          import_batch_id: string | null
          interval_days: number
          is_leech: boolean
          jingle_audio_url: string | null
          jingle_lyrics: string | null
          lapses: number
          last_result: string | null
          last_reviewed_at: string | null
          mnemonic: string | null
          msa_form: string | null
          msa_note: string | null
          next_review_at: string
          phonetic: string | null
          production_difficulty: number
          production_ease_factor: number
          production_interval_days: number
          production_lapses: number
          production_last_reviewed_at: string | null
          production_next_review_at: string | null
          production_repetitions: number
          repetitions: number
          review_count: number
          root: string | null
          sentence_audio_url: string | null
          sentence_english: string | null
          sentence_text: string | null
          source: string | null
          source_upload_id: string | null
          stage: string
          tags: string[] | null
          transliteration: string | null
          updated_at: string
          user_id: string
          word_arabic: string
          word_audio_url: string | null
          word_english: string
        }
        Insert: {
          anki_card_id?: number | null
          anki_note_id?: number | null
          correct_count?: number
          created_at?: string
          deck_name?: string | null
          dialect?: string
          difficulty?: number
          ease_factor?: number
          id?: string
          image_url?: string | null
          import_batch_id?: string | null
          interval_days?: number
          is_leech?: boolean
          jingle_audio_url?: string | null
          jingle_lyrics?: string | null
          lapses?: number
          last_result?: string | null
          last_reviewed_at?: string | null
          mnemonic?: string | null
          msa_form?: string | null
          msa_note?: string | null
          next_review_at?: string
          phonetic?: string | null
          production_difficulty?: number
          production_ease_factor?: number
          production_interval_days?: number
          production_lapses?: number
          production_last_reviewed_at?: string | null
          production_next_review_at?: string | null
          production_repetitions?: number
          repetitions?: number
          review_count?: number
          root?: string | null
          sentence_audio_url?: string | null
          sentence_english?: string | null
          sentence_text?: string | null
          source?: string | null
          source_upload_id?: string | null
          stage?: string
          tags?: string[] | null
          transliteration?: string | null
          updated_at?: string
          user_id: string
          word_arabic: string
          word_audio_url?: string | null
          word_english: string
        }
        Update: {
          anki_card_id?: number | null
          anki_note_id?: number | null
          correct_count?: number
          created_at?: string
          deck_name?: string | null
          dialect?: string
          difficulty?: number
          ease_factor?: number
          id?: string
          image_url?: string | null
          import_batch_id?: string | null
          interval_days?: number
          is_leech?: boolean
          jingle_audio_url?: string | null
          jingle_lyrics?: string | null
          lapses?: number
          last_result?: string | null
          last_reviewed_at?: string | null
          mnemonic?: string | null
          msa_form?: string | null
          msa_note?: string | null
          next_review_at?: string
          phonetic?: string | null
          production_difficulty?: number
          production_ease_factor?: number
          production_interval_days?: number
          production_lapses?: number
          production_last_reviewed_at?: string | null
          production_next_review_at?: string | null
          production_repetitions?: number
          repetitions?: number
          review_count?: number
          root?: string | null
          sentence_audio_url?: string | null
          sentence_english?: string | null
          sentence_text?: string | null
          source?: string | null
          source_upload_id?: string | null
          stage?: string
          tags?: string[] | null
          transliteration?: string | null
          updated_at?: string
          user_id?: string
          word_arabic?: string
          word_audio_url?: string | null
          word_english?: string
        }
        Relationships: []
      }
      user_xp: {
        Row: {
          created_at: string
          id: string
          level: number
          total_xp: number
          updated_at: string
          user_id: string
          week_start_date: string
          xp_this_week: number
          xp_today: number
          xp_today_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          level?: number
          total_xp?: number
          updated_at?: string
          user_id: string
          week_start_date?: string
          xp_this_week?: number
          xp_today?: number
          xp_today_date?: string
        }
        Update: {
          created_at?: string
          id?: string
          level?: number
          total_xp?: number
          updated_at?: string
          user_id?: string
          week_start_date?: string
          xp_this_week?: number
          xp_today?: number
          xp_today_date?: string
        }
        Relationships: []
      }
      video_likes: {
        Row: {
          created_at: string
          id: string
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_likes_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "discover_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_ratings: {
        Row: {
          created_at: string
          id: string
          rating: number
          updated_at: string
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          rating: number
          updated_at?: string
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          id?: string
          rating?: number
          updated_at?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_ratings_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "discover_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_views: {
        Row: {
          completed: boolean
          id: string
          updated_at: string
          user_id: string
          video_id: string
          watched_at: string
          watched_seconds: number
        }
        Insert: {
          completed?: boolean
          id?: string
          updated_at?: string
          user_id: string
          video_id: string
          watched_at?: string
          watched_seconds?: number
        }
        Update: {
          completed?: boolean
          id?: string
          updated_at?: string
          user_id?: string
          video_id?: string
          watched_at?: string
          watched_seconds?: number
        }
        Relationships: []
      }
      vocab_battles: {
        Row: {
          challenger_id: string
          challenger_played_at: string | null
          challenger_score: number | null
          challenger_time_ms: number | null
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          opponent_id: string
          opponent_played_at: string | null
          opponent_score: number | null
          opponent_time_ms: number | null
          question_count: number
          questions: Json
          status: string
          time_limit_seconds: number
          winner_id: string | null
        }
        Insert: {
          challenger_id: string
          challenger_played_at?: string | null
          challenger_score?: number | null
          challenger_time_ms?: number | null
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          opponent_id: string
          opponent_played_at?: string | null
          opponent_score?: number | null
          opponent_time_ms?: number | null
          question_count?: number
          questions?: Json
          status?: string
          time_limit_seconds?: number
          winner_id?: string | null
        }
        Update: {
          challenger_id?: string
          challenger_played_at?: string | null
          challenger_score?: number | null
          challenger_time_ms?: number | null
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          opponent_id?: string
          opponent_played_at?: string | null
          opponent_score?: number | null
          opponent_time_ms?: number | null
          question_count?: number
          questions?: Json
          status?: string
          time_limit_seconds?: number
          winner_id?: string | null
        }
        Relationships: []
      }
      vocab_game_sets: {
        Row: {
          created_at: string
          created_by: string
          dialect: string
          difficulty: string
          game_type: string
          id: string
          session_id: string | null
          status: string
          title: string
          updated_at: string
          word_pairs: Json
        }
        Insert: {
          created_at?: string
          created_by: string
          dialect?: string
          difficulty?: string
          game_type?: string
          id?: string
          session_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          word_pairs?: Json
        }
        Update: {
          created_at?: string
          created_by?: string
          dialect?: string
          difficulty?: string
          game_type?: string
          id?: string
          session_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          word_pairs?: Json
        }
        Relationships: []
      }
      vocabulary_words: {
        Row: {
          audio_url: string | null
          created_at: string
          dialect_module: string
          display_order: number
          id: string
          image_position: string | null
          image_url: string | null
          lesson_id: string | null
          msa_form: string | null
          msa_note: string | null
          root: string | null
          topic_id: string | null
          updated_at: string
          word_arabic: string
          word_english: string
        }
        Insert: {
          audio_url?: string | null
          created_at?: string
          dialect_module?: string
          display_order?: number
          id?: string
          image_position?: string | null
          image_url?: string | null
          lesson_id?: string | null
          msa_form?: string | null
          msa_note?: string | null
          root?: string | null
          topic_id?: string | null
          updated_at?: string
          word_arabic: string
          word_english: string
        }
        Update: {
          audio_url?: string | null
          created_at?: string
          dialect_module?: string
          display_order?: number
          id?: string
          image_position?: string | null
          image_url?: string | null
          lesson_id?: string | null
          msa_form?: string | null
          msa_note?: string | null
          root?: string | null
          topic_id?: string | null
          updated_at?: string
          word_arabic?: string
          word_english?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_words_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vocabulary_words_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_usage: {
        Row: {
          created_at: string
          id: string
          mode: string
          seconds: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mode: string
          seconds: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mode?: string
          seconds?: number
          user_id?: string
        }
        Relationships: []
      }
      weekly_goals: {
        Row: {
          completed_reviews: number
          created_at: string
          earned_xp: number
          id: string
          target_reviews: number
          target_xp: number
          updated_at: string
          user_id: string
          week_start_date: string
        }
        Insert: {
          completed_reviews?: number
          created_at?: string
          earned_xp?: number
          id?: string
          target_reviews?: number
          target_xp?: number
          updated_at?: string
          user_id: string
          week_start_date?: string
        }
        Update: {
          completed_reviews?: number
          created_at?: string
          earned_xp?: number
          id?: string
          target_reviews?: number
          target_xp?: number
          updated_at?: string
          user_id?: string
          week_start_date?: string
        }
        Relationships: []
      }
      weekly_recommendations: {
        Row: {
          created_at: string
          difficulty_adjustment: string | null
          focus_areas: Json
          id: string
          learning_path_id: string | null
          motivation_message: string | null
          motivation_message_arabic: string | null
          performance_summary: Json
          suggested_content: Json
          user_id: string
          viewed_at: string | null
          vocab_to_review: Json
          week_start: string
        }
        Insert: {
          created_at?: string
          difficulty_adjustment?: string | null
          focus_areas?: Json
          id?: string
          learning_path_id?: string | null
          motivation_message?: string | null
          motivation_message_arabic?: string | null
          performance_summary?: Json
          suggested_content?: Json
          user_id: string
          viewed_at?: string | null
          vocab_to_review?: Json
          week_start?: string
        }
        Update: {
          created_at?: string
          difficulty_adjustment?: string | null
          focus_areas?: Json
          id?: string
          learning_path_id?: string | null
          motivation_message?: string | null
          motivation_message_arabic?: string | null
          performance_summary?: Json
          suggested_content?: Json
          user_id?: string
          viewed_at?: string | null
          vocab_to_review?: Json
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_recommendations_learning_path_id_fkey"
            columns: ["learning_path_id"]
            isOneToOne: false
            referencedRelation: "learning_paths"
            referencedColumns: ["id"]
          },
        ]
      }
      word_reviews: {
        Row: {
          correct_count: number
          created_at: string
          difficulty: number
          ease_factor: number
          id: string
          interval_days: number
          is_leech: boolean
          lapses: number
          last_result: string | null
          last_reviewed_at: string | null
          mnemonic: string | null
          next_review_at: string
          production_difficulty: number
          production_ease_factor: number
          production_interval_days: number
          production_lapses: number
          production_last_reviewed_at: string | null
          production_next_review_at: string | null
          production_repetitions: number
          repetitions: number
          review_count: number
          stage: string
          updated_at: string
          user_id: string
          word_id: string
        }
        Insert: {
          correct_count?: number
          created_at?: string
          difficulty?: number
          ease_factor?: number
          id?: string
          interval_days?: number
          is_leech?: boolean
          lapses?: number
          last_result?: string | null
          last_reviewed_at?: string | null
          mnemonic?: string | null
          next_review_at?: string
          production_difficulty?: number
          production_ease_factor?: number
          production_interval_days?: number
          production_lapses?: number
          production_last_reviewed_at?: string | null
          production_next_review_at?: string | null
          production_repetitions?: number
          repetitions?: number
          review_count?: number
          stage?: string
          updated_at?: string
          user_id: string
          word_id: string
        }
        Update: {
          correct_count?: number
          created_at?: string
          difficulty?: number
          ease_factor?: number
          id?: string
          interval_days?: number
          is_leech?: boolean
          lapses?: number
          last_result?: string | null
          last_reviewed_at?: string | null
          mnemonic?: string | null
          next_review_at?: string
          production_difficulty?: number
          production_ease_factor?: number
          production_interval_days?: number
          production_lapses?: number
          production_last_reviewed_at?: string | null
          production_next_review_at?: string | null
          production_repetitions?: number
          repetitions?: number
          review_count?: number
          stage?: string
          updated_at?: string
          user_id?: string
          word_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "word_reviews_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_words"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      asr_engine_corrections: {
        Row: {
          corrected_lines: number | null
          dialect: string | null
          engine: string | null
          week: string | null
        }
        Relationships: []
      }
      leaderboard_profiles: {
        Row: {
          avatar_url: string | null
          custom_institution: string | null
          display_name: string | null
          institution_id: string | null
          show_institution: boolean | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          custom_institution?: string | null
          display_name?: string | null
          institution_id?: string | null
          show_institution?: boolean | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          custom_institution?: string | null
          display_name?: string | null
          institution_id?: string | null
          show_institution?: boolean | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_find_user: {
        Args: { _identifier: string }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      admin_list_managed_roles: {
        Args: never
        Returns: {
          created_at: string
          email: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      award_xp: { Args: { _amount: number; _reason?: string }; Returns: Json }
      can_manage_content: { Args: never; Returns: boolean }
      grant_achievement: { Args: { _achievement_id: string }; Returns: Json }
      has_bible_access: { Args: never; Returns: boolean }
      has_complimentary_access: { Args: { _user_id: string }; Returns: boolean }
      has_redeemed_invite: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_listen_play_count: {
        Args: { _episode_id: string }
        Returns: undefined
      }
      increment_new_card_count: { Args: { _amount?: number }; Returns: number }
      increment_review_count: { Args: never; Returns: undefined }
      increment_usage_counter: {
        Args: { _amount?: number; _key: string; _user_id: string }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      is_beta_tester: { Args: never; Returns: boolean }
      is_content_reviewer: { Args: never; Returns: boolean }
      is_recorder: { Args: never; Returns: boolean }
      match_content: {
        Args: {
          match_count?: number
          match_dialect?: string
          match_kind?: string
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          content: string
          dialect: string
          kind: string
          similarity: number
          source_id: string
        }[]
      }
      record_checkpoint: {
        Args: { _index: number; _score: number }
        Returns: undefined
      }
      redeem_invite_code: { Args: { _code: string }; Returns: Json }
      user_has_bible_access: { Args: { _user_id: string }; Returns: boolean }
      verify_invite_code: { Args: { _code: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "admin"
        | "user"
        | "recorder"
        | "bible_reader"
        | "beta_tester"
        | "content_reviewer"
        | "complimentary"
      concept_kind: "vocab" | "grammar" | "theme" | "scenario" | "phrase"
      concept_role: "introduce" | "reinforce" | "assess"
      mastery_strength: "new" | "learning" | "familiar" | "strong" | "mastered"
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
  public: {
    Enums: {
      app_role: [
        "admin",
        "user",
        "recorder",
        "bible_reader",
        "beta_tester",
        "content_reviewer",
        "complimentary",
      ],
      concept_kind: ["vocab", "grammar", "theme", "scenario", "phrase"],
      concept_role: ["introduce", "reinforce", "assess"],
      mastery_strength: ["new", "learning", "familiar", "strong", "mastered"],
    },
  },
} as const
