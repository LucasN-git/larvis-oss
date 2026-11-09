export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      agent_tasks: {
        Row: {
          created_at: string
          created_by: string | null
          error: string | null
          finished_at: string | null
          id: string
          model: string | null
          project_id: string | null
          prompt_md: string
          result_md: string | null
          started_at: string | null
          status: string
          title: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          model?: string | null
          project_id?: string | null
          prompt_md: string
          result_md?: string | null
          started_at?: string | null
          status?: string
          title?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          model?: string | null
          project_id?: string | null
          prompt_md?: string
          result_md?: string | null
          started_at?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: 'agent_tasks_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }
      briefings: {
        Row: {
          content_md: string
          created_at: string
          date: string
          id: string
          model: string | null
          read_at: string | null
        }
        ComputedFields: never
        Insert: {
          content_md: string
          created_at?: string
          date: string
          id?: string
          model?: string | null
          read_at?: string | null
        }
        Update: {
          content_md?: string
          created_at?: string
          date?: string
          id?: string
          model?: string | null
          read_at?: string | null
        }
        Relationships: []
      }
      calendar_accounts: {
        Row: {
          access_token: string | null
          created_at: string
          expiry: string | null
          google_email: string | null
          id: string
          larvis_calendar_id: string | null
          provider: string
          refresh_token: string | null
          scopes: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          access_token?: string | null
          created_at?: string
          expiry?: string | null
          google_email?: string | null
          id?: string
          larvis_calendar_id?: string | null
          provider?: string
          refresh_token?: string | null
          scopes?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          expiry?: string | null
          google_email?: string | null
          id?: string
          larvis_calendar_id?: string | null
          provider?: string
          refresh_token?: string | null
          scopes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      calendar_subscriptions: {
        Row: {
          color: string
          created_at: string
          deleted_at: string | null
          enabled: boolean
          id: string
          last_error: string | null
          last_synced_at: string | null
          name: string
          project_id: string | null
          updated_at: string
          url: string
        }
        ComputedFields: never
        Insert: {
          color?: string
          created_at?: string
          deleted_at?: string | null
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          name: string
          project_id?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          color?: string
          created_at?: string
          deleted_at?: string | null
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          name?: string
          project_id?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: 'calendar_subscriptions_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }
      contacts: {
        Row: {
          addresses: NonNullable<Json>
          birthday: string | null
          birthday_year_known: boolean
          business: boolean
          company: string | null
          created_at: string
          current_status: string
          deleted_at: string | null
          emails: NonNullable<Json>
          first_name: string
          id: string
          last_name: string
          linkedin_url: string | null
          links: NonNullable<Json>
          nickname: string | null
          notes_md: string
          phones: NonNullable<Json>
          position: string | null
          source: string
          tags: string[]
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          addresses?: NonNullable<Json>
          birthday?: string | null
          birthday_year_known?: boolean
          business?: boolean
          company?: string | null
          created_at?: string
          current_status?: string
          deleted_at?: string | null
          emails?: NonNullable<Json>
          first_name?: string
          id?: string
          last_name?: string
          linkedin_url?: string | null
          links?: NonNullable<Json>
          nickname?: string | null
          notes_md?: string
          phones?: NonNullable<Json>
          position?: string | null
          source?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          addresses?: NonNullable<Json>
          birthday?: string | null
          birthday_year_known?: boolean
          business?: boolean
          company?: string | null
          created_at?: string
          current_status?: string
          deleted_at?: string | null
          emails?: NonNullable<Json>
          first_name?: string
          id?: string
          last_name?: string
          linkedin_url?: string | null
          links?: NonNullable<Json>
          nickname?: string | null
          notes_md?: string
          phones?: NonNullable<Json>
          position?: string | null
          source?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      entries: {
        Row: {
          also_areas: string[]
          area: string
          captured_at: string
          category: string | null
          comment: string
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          name: string
          notes_md: string
          search: unknown
          source_author: string | null
          source_author_handle: string | null
          source_duration_seconds: number | null
          source_media_type: string | null
          source_page_count: number | null
          source_platform: string | null
          source_published_at: string | null
          source_title: string | null
          source_word_count: number | null
          tags: string[]
          updated_at: string
          upload_id: string | null
          url: string | null
        }
        ComputedFields: never
        Insert: {
          also_areas?: string[]
          area: string
          captured_at?: string
          category?: string | null
          comment?: string
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          name: string
          notes_md?: string
          search?: never
          source_author?: string | null
          source_author_handle?: string | null
          source_duration_seconds?: number | null
          source_media_type?: string | null
          source_page_count?: number | null
          source_platform?: string | null
          source_published_at?: string | null
          source_title?: string | null
          source_word_count?: number | null
          tags?: string[]
          updated_at?: string
          upload_id?: string | null
          url?: string | null
        }
        Update: {
          also_areas?: string[]
          area?: string
          captured_at?: string
          category?: string | null
          comment?: string
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          name?: string
          notes_md?: string
          search?: never
          source_author?: string | null
          source_author_handle?: string | null
          source_duration_seconds?: number | null
          source_media_type?: string | null
          source_page_count?: number | null
          source_platform?: string | null
          source_published_at?: string | null
          source_title?: string | null
          source_word_count?: number | null
          tags?: string[]
          updated_at?: string
          upload_id?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'entries_upload_id_fkey'
            columns: ['upload_id']
            isOneToOne: false
            referencedRelation: 'uploads'
            referencedColumns: ['id']
          },
        ]
      }
      inbox: {
        Row: {
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          note: string | null
          processed: boolean
          processed_at: string | null
          scan_note: string | null
          scanned_at: string | null
          upload_id: string | null
        }
        ComputedFields: never
        Insert: {
          content: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          note?: string | null
          processed?: boolean
          processed_at?: string | null
          scan_note?: string | null
          scanned_at?: string | null
          upload_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          note?: string | null
          processed?: boolean
          processed_at?: string | null
          scan_note?: string | null
          scanned_at?: string | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inbox_upload_id_fkey'
            columns: ['upload_id']
            isOneToOne: false
            referencedRelation: 'uploads'
            referencedColumns: ['id']
          },
        ]
      }
      items: {
        Row: {
          area: string
          category: string | null
          created_at: string
          deleted_at: string | null
          id: string
          location: string
          name: string
          notes_md: string
          project_id: string | null
          search: unknown
          tags: string[]
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          area?: string
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          location?: string
          name: string
          notes_md?: string
          project_id?: string | null
          search?: never
          tags?: string[]
          updated_at?: string
        }
        Update: {
          area?: string
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          location?: string
          name?: string
          notes_md?: string
          project_id?: string | null
          search?: never
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'items_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }
      learning_attachments: {
        Row: {
          created_at: string
          filename: string
          id: string
          inline: boolean
          kind: string
          learning_id: string
          mime_type: string
          size_bytes: number
          sort_order: number
          storage_path: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          filename?: string
          id?: string
          inline?: boolean
          kind?: string
          learning_id: string
          mime_type?: string
          size_bytes?: number
          sort_order?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          inline?: boolean
          kind?: string
          learning_id?: string
          mime_type?: string
          size_bytes?: number
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: 'learning_attachments_learning_id_fkey'
            columns: ['learning_id']
            isOneToOne: false
            referencedRelation: 'learnings'
            referencedColumns: ['id']
          },
        ]
      }
      learning_sources: {
        Row: {
          comment: string
          created_at: string
          entry_id: string | null
          id: string
          learning_id: string
          note_id: string | null
          role: string
          sort_order: number
        }
        ComputedFields: never
        Insert: {
          comment?: string
          created_at?: string
          entry_id?: string | null
          id?: string
          learning_id: string
          note_id?: string | null
          role?: string
          sort_order?: number
        }
        Update: {
          comment?: string
          created_at?: string
          entry_id?: string | null
          id?: string
          learning_id?: string
          note_id?: string | null
          role?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: 'learning_sources_entry_id_fkey'
            columns: ['entry_id']
            isOneToOne: false
            referencedRelation: 'entries'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'learning_sources_learning_id_fkey'
            columns: ['learning_id']
            isOneToOne: false
            referencedRelation: 'learnings'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'learning_sources_note_id_fkey'
            columns: ['note_id']
            isOneToOne: false
            referencedRelation: 'notes'
            referencedColumns: ['id']
          },
        ]
      }
      learnings: {
        Row: {
          area: string
          body_md: string
          created_at: string
          deleted_at: string | null
          id: string
          parent_id: string | null
          search: unknown
          slug: string
          sort_order: number
          summary: string | null
          tags: string[]
          title: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          area: string
          body_md?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          parent_id?: string | null
          search?: never
          slug: string
          sort_order?: number
          summary?: string | null
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          area?: string
          body_md?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          parent_id?: string | null
          search?: never
          slug?: string
          sort_order?: number
          summary?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'learnings_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'learnings'
            referencedColumns: ['id']
          },
        ]
      }
      learnweb_announcements: {
        Row: {
          author: string | null
          body_text: string
          course_id: string
          created_at: string
          deleted_at: string | null
          discussion_id: number
          first_seen_at: string
          id: string
          pinned: boolean
          posted_at: string | null
          search: unknown
          subject: string
          updated_at: string
          url: string
        }
        ComputedFields: never
        Insert: {
          author?: string | null
          body_text?: string
          course_id: string
          created_at?: string
          deleted_at?: string | null
          discussion_id: number
          first_seen_at?: string
          id?: string
          pinned?: boolean
          posted_at?: string | null
          search?: never
          subject: string
          updated_at?: string
          url: string
        }
        Update: {
          author?: string | null
          body_text?: string
          course_id?: string
          created_at?: string
          deleted_at?: string | null
          discussion_id?: number
          first_seen_at?: string
          id?: string
          pinned?: boolean
          posted_at?: string | null
          search?: never
          subject?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: 'learnweb_announcements_course_id_fkey'
            columns: ['course_id']
            isOneToOne: false
            referencedRelation: 'learnweb_courses'
            referencedColumns: ['id']
          },
        ]
      }
      learnweb_courses: {
        Row: {
          content_hash: string | null
          created_at: string
          deleted_at: string | null
          enddate: string | null
          first_seen_at: string
          fullname: string
          id: string
          last_synced_at: string | null
          moodle_id: number
          project_id: string | null
          shortname: string
          startdate: string | null
          updated_at: string
          url: string
          visible: boolean
        }
        ComputedFields: never
        Insert: {
          content_hash?: string | null
          created_at?: string
          deleted_at?: string | null
          enddate?: string | null
          first_seen_at?: string
          fullname: string
          id?: string
          last_synced_at?: string | null
          moodle_id: number
          project_id?: string | null
          shortname?: string
          startdate?: string | null
          updated_at?: string
          url: string
          visible?: boolean
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          deleted_at?: string | null
          enddate?: string | null
          first_seen_at?: string
          fullname?: string
          id?: string
          last_synced_at?: string | null
          moodle_id?: number
          project_id?: string | null
          shortname?: string
          startdate?: string | null
          updated_at?: string
          url?: string
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'learnweb_courses_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }
      learnweb_events: {
        Row: {
          course_id: string | null
          created_at: string
          deleted_at: string | null
          event_id: number
          id: string
          modulename: string | null
          name: string
          starts_at: string
          updated_at: string
          url: string | null
        }
        ComputedFields: never
        Insert: {
          course_id?: string | null
          created_at?: string
          deleted_at?: string | null
          event_id: number
          id?: string
          modulename?: string | null
          name: string
          starts_at: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          course_id?: string | null
          created_at?: string
          deleted_at?: string | null
          event_id?: number
          id?: string
          modulename?: string | null
          name?: string
          starts_at?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'learnweb_events_course_id_fkey'
            columns: ['course_id']
            isOneToOne: false
            referencedRelation: 'learnweb_courses'
            referencedColumns: ['id']
          },
        ]
      }
      learnweb_items: {
        Row: {
          cmid: number
          course_id: string
          created_at: string
          deleted_at: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          modtype: string
          name: string
          section_id: number | null
          section_name: string
          size_text: string | null
          sort_order: number
          subsection_name: string | null
          type_label: string
          updated_at: string
          url: string
        }
        ComputedFields: never
        Insert: {
          cmid: number
          course_id: string
          created_at?: string
          deleted_at?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          modtype?: string
          name: string
          section_id?: number | null
          section_name?: string
          size_text?: string | null
          sort_order?: number
          subsection_name?: string | null
          type_label?: string
          updated_at?: string
          url: string
        }
        Update: {
          cmid?: number
          course_id?: string
          created_at?: string
          deleted_at?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          modtype?: string
          name?: string
          section_id?: number | null
          section_name?: string
          size_text?: string | null
          sort_order?: number
          subsection_name?: string | null
          type_label?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: 'learnweb_items_course_id_fkey'
            columns: ['course_id']
            isOneToOne: false
            referencedRelation: 'learnweb_courses'
            referencedColumns: ['id']
          },
        ]
      }
      learnweb_videos: {
        Row: {
          course_id: string
          created_at: string
          deleted_at: string | null
          duration_seconds: number | null
          episode_key: string
          episode_url: string
          error: string | null
          first_seen_at: string
          id: string
          item_id: string | null
          kind: string
          model: string | null
          preview_url: string | null
          recorded_at: string | null
          search: unknown
          segments: NonNullable<Json>
          sort_order: number
          status: string
          title: string
          transcribed_at: string | null
          transcript_md: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          course_id: string
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          episode_key: string
          episode_url: string
          error?: string | null
          first_seen_at?: string
          id?: string
          item_id?: string | null
          kind?: string
          model?: string | null
          preview_url?: string | null
          recorded_at?: string | null
          search?: never
          segments?: NonNullable<Json>
          sort_order?: number
          status?: string
          title: string
          transcribed_at?: string | null
          transcript_md?: string
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          episode_key?: string
          episode_url?: string
          error?: string | null
          first_seen_at?: string
          id?: string
          item_id?: string | null
          kind?: string
          model?: string | null
          preview_url?: string | null
          recorded_at?: string | null
          search?: never
          segments?: NonNullable<Json>
          sort_order?: number
          status?: string
          title?: string
          transcribed_at?: string | null
          transcript_md?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'learnweb_videos_course_id_fkey'
            columns: ['course_id']
            isOneToOne: false
            referencedRelation: 'learnweb_courses'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'learnweb_videos_item_id_fkey'
            columns: ['item_id']
            isOneToOne: false
            referencedRelation: 'learnweb_items'
            referencedColumns: ['id']
          },
        ]
      }
      memories: {
        Row: {
          content_md: string
          created_at: string
          id: string
          kind: string
          scope: string | null
          slug: string
          title: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          content_md?: string
          created_at?: string
          id?: string
          kind?: string
          scope?: string | null
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          content_md?: string
          created_at?: string
          id?: string
          kind?: string
          scope?: string | null
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      note_attachments: {
        Row: {
          created_at: string
          filename: string
          id: string
          inline: boolean
          kind: string
          mime_type: string
          note_id: string
          size_bytes: number
          sort_order: number
          storage_path: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          filename?: string
          id?: string
          inline?: boolean
          kind?: string
          mime_type?: string
          note_id: string
          size_bytes?: number
          sort_order?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          inline?: boolean
          kind?: string
          mime_type?: string
          note_id?: string
          size_bytes?: number
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: 'note_attachments_note_id_fkey'
            columns: ['note_id']
            isOneToOne: false
            referencedRelation: 'notes'
            referencedColumns: ['id']
          },
        ]
      }
      notes: {
        Row: {
          archived_at: string | null
          area: string
          body_md: string
          created_at: string
          deleted_at: string | null
          graph: Json | null
          icon: string | null
          id: string
          parent_id: string | null
          previous_version_id: string | null
          project_id: string | null
          search: unknown
          series_id: string
          sort_order: number
          superseded_at: string | null
          tags: string[]
          title: string
          updated_at: string
          version_no: number
        }
        ComputedFields: never
        Insert: {
          archived_at?: string | null
          area?: string
          body_md?: string
          created_at?: string
          deleted_at?: string | null
          graph?: Json | null
          icon?: string | null
          id?: string
          parent_id?: string | null
          previous_version_id?: string | null
          project_id?: string | null
          search?: never
          series_id?: string
          sort_order?: number
          superseded_at?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          version_no?: number
        }
        Update: {
          archived_at?: string | null
          area?: string
          body_md?: string
          created_at?: string
          deleted_at?: string | null
          graph?: Json | null
          icon?: string | null
          id?: string
          parent_id?: string | null
          previous_version_id?: string | null
          project_id?: string | null
          search?: never
          series_id?: string
          sort_order?: number
          superseded_at?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: 'notes_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'notes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notes_previous_version_id_fkey'
            columns: ['previous_version_id']
            isOneToOne: false
            referencedRelation: 'notes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notes_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }
      notification_log: {
        Row: {
          body: string
          category: string
          key: string
          sent_at: string
          title: string
        }
        ComputedFields: never
        Insert: {
          body?: string
          category: string
          key: string
          sent_at?: string
          title?: string
        }
        Update: {
          body?: string
          category?: string
          key?: string
          sent_at?: string
          title?: string
        }
        Relationships: []
      }
      notification_settings: {
        Row: {
          created_at: string
          id: number
          prefs: NonNullable<Json>
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: number
          prefs?: NonNullable<Json>
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          prefs?: NonNullable<Json>
          updated_at?: string
        }
        Relationships: []
      }
      places: {
        Row: {
          address: string
          aliases: string[]
          city: string
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          notes_md: string
          travel_minutes: number | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          address?: string
          aliases?: string[]
          city?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          notes_md?: string
          travel_minutes?: number | null
          updated_at?: string
        }
        Update: {
          address?: string
          aliases?: string[]
          city?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          notes_md?: string
          travel_minutes?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          color: string | null
          created_at: string
          deleted_at: string | null
          description_md: string
          icon: string | null
          id: string
          local_path: string | null
          name: string
          parent_id: string | null
          slug: string
          sort_order: number
          status: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          description_md?: string
          icon?: string | null
          id?: string
          local_path?: string | null
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          description_md?: string
          icon?: string | null
          id?: string
          local_path?: string | null
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'projects_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          user_agent: string | null
        }
        ComputedFields: never
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      reminders: {
        Row: {
          calendar_id: string | null
          created_at: string
          custom: boolean
          event_id: string | null
          id: string
          kind: string
          notify_at: string | null
          sent_at: string | null
          start_at: string | null
          title: string | null
          todo_id: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          calendar_id?: string | null
          created_at?: string
          custom?: boolean
          event_id?: string | null
          id?: string
          kind: string
          notify_at?: string | null
          sent_at?: string | null
          start_at?: string | null
          title?: string | null
          todo_id?: string | null
          updated_at?: string
        }
        Update: {
          calendar_id?: string | null
          created_at?: string
          custom?: boolean
          event_id?: string | null
          id?: string
          kind?: string
          notify_at?: string | null
          sent_at?: string | null
          start_at?: string | null
          title?: string | null
          todo_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'reminders_todo_id_fkey'
            columns: ['todo_id']
            isOneToOne: false
            referencedRelation: 'todos'
            referencedColumns: ['id']
          },
        ]
      }
      todos: {
        Row: {
          area: string
          backlog: boolean
          body_md: string
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          due_at: string | null
          gcal_event_id: string | null
          id: string
          priority: number
          project_id: string | null
          sort_order: number
          status: string
          tags: string[]
          title: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          area?: string
          backlog?: boolean
          body_md?: string
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          due_at?: string | null
          gcal_event_id?: string | null
          id?: string
          priority?: number
          project_id?: string | null
          sort_order?: number
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          area?: string
          backlog?: boolean
          body_md?: string
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          due_at?: string | null
          gcal_event_id?: string | null
          id?: string
          priority?: number
          project_id?: string | null
          sort_order?: number
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'todos_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }
      uploads: {
        Row: {
          created_at: string
          filename: string
          id: string
          mime_type: string
          size_bytes: number
          storage_path: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          filename?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: []
      }
    }
    Views: {
      area_usage: {
        Row: {
          area: string | null
          count: number | null
          source: string | null
        }
        ComputedFields: never
        Relationships: []
      }
    }
    Functions: {
      create_note_version: {
        Args: { p_body_md?: string; p_graph?: Json; p_icon?: string; p_id: string; p_tags?: string[]; p_title?: string }
        Returns: {
          archived_at: string | null
          area: string
          body_md: string
          created_at: string
          deleted_at: string | null
          graph: Json | null
          icon: string | null
          id: string
          parent_id: string | null
          previous_version_id: string | null
          project_id: string | null
          search: unknown
          series_id: string
          sort_order: number
          superseded_at: string | null
          tags: string[]
          title: string
          updated_at: string
          version_no: number
        }
        SetofOptions: {
          from: '*'
          to: 'notes'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      immutable_array_to_string: { Args: { arr: string[]; sep: string }; Returns: string }
      is_owner: { Args: Record<PropertyKey, never>; Returns: boolean }
      mcp_access_token_hook: { Args: { event: Json }; Returns: Json }
      verify_cron_secret: { Args: { candidate: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
