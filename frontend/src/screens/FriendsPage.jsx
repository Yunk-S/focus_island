import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Search,
  Plus,
  Send,
  Image,
  Paperclip,
  Mic,
  MicOff,
  Smile,
  X,
  UserPlus,
  Check,
  Trash2,
  MessageCircle,
  Crown,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n/I18nContext';
import { buildDicebearAvatarUrl } from '../lib/avatarUrl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const EMOJI_LIST = ['😀', '😂', '😍', '🥰', '😎', '🤩', '😜', '🤗', '🥳', '😴', '🤔', '😅'];

const mockFriends = [
  { id: 'f1', name: 'Emma Wilson', uniqueId: 'FI-1234-5678-9012', avatar: null, isOnline: true, lastMessage: '一起专注吧！', lastActive: Date.now() },
  { id: 'f2', name: 'Yunkun', uniqueId: 'FI-2345-6789-0123', avatar: null, isOnline: true, lastMessage: '加油！', lastActive: Date.now() },
  { id: 'f3', name: 'Sarah Kim', uniqueId: 'FI-3456-7890-1234', avatar: null, isOnline: false, lastMessage: '好的', lastActive: Date.now() - 3600000 },
];

const mockRequests = [
  { id: 'r1', name: 'James Lee', uniqueId: 'FI-4567-8901-2345', avatar: null, from: 'James' },
];

function AvatarImage({ src, name, className }) {
  const [failed, setFailed] = useState(false);
  const initials = (name || '?').trim().slice(0, 2).toUpperCase() || '?';
  const safe = src && typeof src === 'string' && src.trim() !== '';
  if (!safe || failed) {
    return (
      <div
        className={`${className} flex shrink-0 items-center justify-center bg-gradient-to-br from-primary/35 to-pink-500/35 text-[10px] font-semibold tracking-tight text-foreground`}
        aria-hidden
      >
        {initials}
      </div>
    );
  }
  return <img src={src} alt="" className={className} onError={() => setFailed(true)} />;
}

function ChatBubble({ message, isSelf }) {
  return (
    <div className={`flex ${isSelf ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
          isSelf
            ? 'bg-gradient-to-r from-primary to-pink-500 text-white rounded-br-md'
            : 'bg-muted/60 text-foreground rounded-bl-md'
        }`}
      >
        {message.type === 'voice' ? (
          <div className="flex items-center gap-2">
            <Mic className="size-4" />
            <span className="text-sm">{t('friends.voiceMessage')}</span>
          </div>
        ) : message.type === 'image' ? (
          <img src={message.content} alt="" className="max-w-[200px] max-h-[200px] rounded-lg object-cover" />
        ) : message.type === 'file' ? (
          <div className="flex items-center gap-2">
            <Paperclip className="size-4" />
            <span className="text-sm">{message.fileName}</span>
          </div>
        ) : (
          <p className="text-sm leading-relaxed">{message.content}</p>
        )}
        <p className={`text-[10px] mt-1 ${isSelf ? 'text-white/60' : 'text-muted-foreground'}`}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

function FriendsPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [friends, setFriends] = useState(mockFriends);
  const [requests] = useState(mockRequests);
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [messages, setMessages] = useState({});
  const [inputText, setInputText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addById, setAddById] = useState('');
  const chatEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    if (selectedFriend && messages[selectedFriend.id]) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedFriend, messages]);

  const handleSend = useCallback(() => {
    if (!inputText.trim() || !selectedFriend) return;
    const newMsg = { id: Date.now(), content: inputText.trim(), type: 'text', sender: 'self', timestamp: Date.now() };
    setMessages((prev) => ({
      ...prev,
      [selectedFriend.id]: [...(prev[selectedFriend.id] || []), newMsg],
    }));
    setInputText('');
    // Simulate reply
    setTimeout(() => {
      const reply = { id: Date.now() + 1, content: '收到消息了！', type: 'text', sender: 'other', timestamp: Date.now() };
      setMessages((prev) => ({
        ...prev,
        [selectedFriend.id]: [...(prev[selectedFriend.id] || []), reply],
      }));
    }, 1000);
  }, [inputText, selectedFriend]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleEmojiSelect = (emoji) => {
    setInputText((prev) => prev + emoji);
    setShowEmoji(false);
  };

  const handleSendImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file && selectedFriend) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const newMsg = { id: Date.now(), content: ev.target.result, type: 'image', sender: 'self', timestamp: Date.now() };
          setMessages((prev) => ({
            ...prev,
            [selectedFriend.id]: [...(prev[selectedFriend.id] || []), newMsg],
          }));
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const handleSendFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file && selectedFriend) {
        const newMsg = { id: Date.now(), content: URL.createObjectURL(file), type: 'file', fileName: file.name, sender: 'self', timestamp: Date.now() };
        setMessages((prev) => ({
          ...prev,
          [selectedFriend.id]: [...(prev[selectedFriend.id] || []), newMsg],
        }));
      }
    };
    input.click();
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (selectedFriend) {
          const newMsg = { id: Date.now(), content: URL.createObjectURL(blob), type: 'voice', sender: 'self', timestamp: Date.now() };
          setMessages((prev) => ({
            ...prev,
            [selectedFriend.id]: [...(prev[selectedFriend.id] || []), newMsg],
          }));
        }
        stream.getTracks().forEach((track) => track.stop());
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch {
      // No mic permission
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleAddFriend = () => {
    if (addById.trim()) {
      // Simulate adding
      setShowAddModal(false);
      setAddById('');
    }
  };

  const handleRemoveFriend = (friendId) => {
    setFriends((prev) => prev.filter((f) => f.id !== friendId));
    if (selectedFriend?.id === friendId) setSelectedFriend(null);
  };

  const currentMessages = selectedFriend ? messages[selectedFriend.id] || [] : [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-border/30">
        <button
          type="button"
          onClick={() => navigate('/personal')}
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t('common.backHome')}
        </button>
        <h1 className="text-xl font-bold text-foreground">{t('friends.title')}</h1>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-80 border-r border-border/30 flex flex-col">
          <div className="p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('friends.searchPlaceholder')}
                className="h-10 pl-10"
              />
            </div>
            <Button
              type="button"
              className="w-full gap-2"
              size="sm"
              onClick={() => setShowAddModal(true)}
            >
              <UserPlus className="size-4" />
              {t('friends.addFriend')}
            </Button>
          </div>

          <div className="flex border-b border-border/30">
            <button
              type="button"
              onClick={() => setActiveTab('friends')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                activeTab === 'friends'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-muted-foreground'
              }`}
            >
              {t('friends.friendsList')}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('requests')}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === 'requests'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-muted-foreground'
              }`}
            >
              {t('friends.requests')}
              {requests.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 size-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center">
                  {requests.length}
                </span>
              )}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {activeTab === 'friends' ? (
              friends.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">{t('friends.noFriends')}</p>
              ) : (
                friends.map((friend) => (
                  <button
                    key={friend.id}
                    type="button"
                    onClick={() => setSelectedFriend(friend)}
                    className={`w-full flex items-center gap-3 rounded-xl p-3 text-left transition-colors ${
                      selectedFriend?.id === friend.id
                        ? 'bg-primary/15 border border-primary/30'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="relative">
                      <AvatarImage
                        src={friend.avatar || buildDicebearAvatarUrl(friend.name)}
                        name={friend.name}
                        className="size-10 rounded-full"
                      />
                      {friend.isOnline && (
                        <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-green-500 border-2 border-background" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{friend.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{friend.lastMessage}</p>
                    </div>
                  </button>
                ))
              )
            ) : requests.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">{t('friends.noRequests')}</p>
            ) : (
              requests.map((req) => (
                <div key={req.id} className="flex items-center gap-3 rounded-xl p-3 bg-muted/30">
                  <AvatarImage
                    src={req.avatar || buildDicebearAvatarUrl(req.name)}
                    name={req.name}
                    className="size-10 rounded-full"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{req.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{req.uniqueId}</p>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" className="p-1.5 rounded-lg bg-green-500/20 text-green-500 hover:bg-green-500/30 transition-colors">
                      <Check className="size-4" />
                    </button>
                    <button type="button" className="p-1.5 rounded-lg bg-red-500/20 text-red-500 hover:bg-red-500/30 transition-colors">
                      <X className="size-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col">
          {selectedFriend ? (
            <>
              <div className="flex items-center gap-3 px-6 py-3 border-b border-border/30">
                <div className="relative">
                  <AvatarImage
                    src={selectedFriend.avatar || buildDicebearAvatarUrl(selectedFriend.name)}
                    name={selectedFriend.name}
                    className="size-10 rounded-full"
                  />
                  {selectedFriend.isOnline && (
                    <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-green-500 border-2 border-background" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{selectedFriend.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedFriend.isOnline ? t('friends.online') : t('friends.offline')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFriend(selectedFriend.id)}
                  className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                  title={t('friends.removeFriend')}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {currentMessages.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-8">{t('live.chatEmpty')}</p>
                ) : (
                  currentMessages.map((msg) => (
                    <ChatBubble key={msg.id} message={msg} isSelf={msg.sender === 'self'} />
                  ))
                )}
                <div ref={chatEndRef} />
              </div>

              <AnimatePresence>
                {showEmoji && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="px-4 pb-2"
                  >
                    <div className="flex flex-wrap gap-2 rounded-xl bg-card border border-border/40 p-3">
                      {EMOJI_LIST.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => handleEmojiSelect(emoji)}
                          className="p-1.5 text-lg hover:bg-muted rounded-lg transition-colors"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="p-4 border-t border-border/30">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowEmoji(!showEmoji)}
                    className="p-2.5 rounded-xl hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    title={t('friends.emoji')}
                  >
                    <Smile className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleSendImage}
                    className="p-2.5 rounded-xl hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    title={t('friends.sendImage')}
                  >
                    <Image className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleSendFile}
                    className="p-2.5 rounded-xl hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    title={t('friends.sendFile')}
                  >
                    <Paperclip className="size-5" />
                  </button>
                  <div className="flex-1">
                    <Input
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={t('friends.typePlaceholder')}
                      className="h-11"
                    />
                  </div>
                  {isRecording ? (
                    <Button type="button" variant="destructive" onClick={handleStopRecording} className="gap-2 animate-pulse">
                      <MicOff className="size-4" />
                      {t('friends.clickToCancel')}
                    </Button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={isRecording ? handleStopRecording : handleStartRecording}
                        className="p-2.5 rounded-xl hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                        title={t('friends.voiceMessage')}
                      >
                        {isRecording ? <MicOff className="size-5 text-red-500" /> : <Mic className="size-5" />}
                      </button>
                      <Button type="button" onClick={handleSend} disabled={!inputText.trim()} className="gap-2">
                        <Send className="size-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <MessageCircle className="size-16 text-muted-foreground/50 mb-4" />
              <p className="text-lg font-medium text-muted-foreground">{t('friends.friendsList')}</p>
              <p className="text-sm text-muted-foreground mt-2">{t('friends.noFriends')}</p>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm rounded-2xl border border-border/40 bg-card p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">{t('friends.addById')}</h2>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                >
                  <X className="size-5 text-muted-foreground" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground mb-4">{t('friends.addFriendHint')}</p>
              <div className="space-y-4">
                <Input
                  value={addById}
                  onChange={(e) => setAddById(e.target.value)}
                  placeholder={t('friends.searchPlaceholder')}
                  className="h-11 font-mono"
                />
                <Button type="button" className="w-full gap-2" onClick={handleAddFriend}>
                  <UserPlus className="size-4" />
                  {t('friends.sendRequest')}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default FriendsPage;
