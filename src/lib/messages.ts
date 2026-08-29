import { supabase } from './supabase';
import type { Message } from '@/types';

export async function listMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Inserts the user's own message directly (RLS allows this — see
 * 0006_rls_policies.sql). The chat edge function then reads the full
 * conversation history itself rather than trusting a copy passed by the
 * client, so there's no way to spoof what "actually happened" in the
 * conversation the model sees.
 */
export async function insertUserMessage(conversationId: string, content: string): Promise<Message> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, user_id: user.id, role: 'user', content })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}
