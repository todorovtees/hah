import { supabase } from './supabase';
import type { Conversation } from '@/types';

export async function listConversations(opts: { archived?: boolean } = {}): Promise<Conversation[]> {
  let query = supabase.from('conversations').select('*').order('updated_at', { ascending: false });
  query = query.eq('archived', opts.archived ?? false);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function searchConversations(term: string): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .ilike('title', `%${term}%`)
    .eq('archived', false)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createConversation(): Promise<Conversation> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: user.id, title: 'Нов разговор' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const { error } = await supabase.from('conversations').update({ title }).eq('id', id);
  if (error) throw error;
}

export async function archiveConversation(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase.from('conversations').update({ archived }).eq('id', id);
  if (error) throw error;
}

export async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase.from('conversations').delete().eq('id', id);
  if (error) throw error;
}
