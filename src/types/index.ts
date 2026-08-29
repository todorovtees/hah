export type Role = 'admin' | 'user';

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Source {
  title: string;
  url: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  user_id: string;
  role: MessageRole;
  content: string;
  sources: Source[] | null;
  created_at: string;
  /** Client-only: true while an assistant message is still streaming in. */
  pending?: boolean;
}

export type AttachmentStatus = 'uploaded' | 'processing' | 'ready' | 'error';

export interface Attachment {
  id: string;
  conversation_id: string;
  message_id: string | null;
  user_id: string;
  filename: string;
  mime_type: string;
  storage_path: string;
  size: number;
  status: AttachmentStatus;
  error_message: string | null;
  created_at: string;
}

export interface AuthorizedUser {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
