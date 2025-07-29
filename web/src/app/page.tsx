"use client";

import { useState, useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { ChatBubble, ChatBubbleAvatar } from "@/components/ui/chat/chat-bubble";
import { ChatBubbleMessage } from "@/components/ui/chat/chat-bubble";
import { ChatInput } from "@/components/ui/chat/chat-input";
import { ChatMessageList } from "@/components/ui/chat/chat-message-list";

interface Message {
  id: string;
  text: string;
  variant: "sent" | "received";
  timestamp: number;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const loadDefaultMessages = async () => {
      try {
        const loadSessionFunction = httpsCallable<
          { userId?: string },
          { messages: Message[] }
        >(functions, "loadSession");

        const result = await loadSessionFunction({ userId: "anonymous" });

        if (result.data.messages) {
          setMessages(result.data.messages);
        }
      } catch (error) {
        console.error("Error loading session:", error);
      } finally {
        setIsInitializing(false);
      }
    };

    loadDefaultMessages();
  }, []);

  const sendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue("");

    const newUserMessage: Message = {
      id: Date.now().toString(),
      text: userMessage,
      variant: "sent",
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, newUserMessage]);

    setIsLoading(true);

    try {
      const chatFunction = httpsCallable<
        { message: string; userId?: string },
        Message | { history: Message[] }
      >(functions, "chat");

      const result = await chatFunction({
        message: userMessage,
        userId: "anonymous",
      });

      if ("history" in result.data) {
        setMessages(result.data.history);
      } else {
        const aiMessage = result.data as Message;
        setMessages((prev) => [...prev, aiMessage]);
      }
    } catch (error) {
      console.error("Error calling chat function:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "Sorry, I encountered an error. Please try again.",
        variant: "received",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background font-[family-name:var(--font-geist-sans)]">
      <div className="w-full max-w-md h-screen sm:h-[600px] sm:my-4 bg-background sm:rounded-lg sm:shadow-lg overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
          <ChatMessageList className="h-full">
            {messages.map((message) => (
              <ChatBubble key={message.id} variant={message.variant}>
                <ChatBubbleAvatar
                  fallback={message.variant === "sent" ? "US" : "AI"}
                />
                <ChatBubbleMessage variant={message.variant}>
                  {message.text}
                </ChatBubbleMessage>
              </ChatBubble>
            ))}
            {isLoading && (
              <ChatBubble variant="received">
                <ChatBubbleAvatar fallback="AI" />
                <ChatBubbleMessage isLoading />
              </ChatBubble>
            )}
          </ChatMessageList>
        </div>
        <div className="p-4">
          <ChatInput
            placeholder="Type your message here..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            disabled={isLoading || isInitializing}
          />
        </div>
      </div>
    </div>
  );
}
