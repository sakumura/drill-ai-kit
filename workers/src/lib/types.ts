export interface Question {
  id: string
  lesson_id: string
  position: number
  question_text: string
  question_image_url: string | null
  figure_svg: string | null
  answer: string
  answer_unit: string | null
  hints: string[]
  solution_steps: string[]
  common_mistakes: { mistake: string; guidance: string }[]
  diag_step1: { question_text: string; choices: { text: string; isCorrect: boolean }[]; solution_steps: string[] } | null
  diag_step2: { question_text: string; choices: { text: string; isCorrect: boolean }[]; solution_steps: string[] } | null
}

export interface ConceptCard {
  title: string
  text: string
  image_hint?: string
}

export interface ReadingPassage {
  id: string
  lesson_id: string
  position: number
  paragraph_text: string
}

export interface ReadingQuestion {
  id: string
  passage_id: string
  lesson_id: string
  position: number
  question_type: 'choice4'
  question_text: string
  choices: { text: string; isCorrect: boolean }[]
  correct_answer: string
  explanation: string | null
  difficulty_tier: number  // 1=事実確認, 2=因果関係, 3=心情, 4=要旨
}

export interface Lesson {
  id: string
  unit_id: string
  title: string
  concept_cards: ConceptCard[]
  tips: string[]
  difficulty: number
  grade: number
  subject: 'math' | 'japanese'
  lesson_type: 'flash' | 'reading'
  questions?: Question[]
  passages?: ReadingPassage[]
  reading_questions?: ReadingQuestion[]
}

export interface Answer {
  id: string
  question_id: string
  lesson_id: string
  user_answer: string | null
  is_correct: number
  time_spent_sec: number | null
  hints_used: number
  ai_conversation: string | null
  understanding_level: number | null
  answered_at: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface CheckRequest {
  question_id: string
  user_answer: string
  correct_answer: string
  question_text?: string
}

export interface CheckResponse {
  correct: boolean
  feedback: string
}

export interface ChatRequest {
  question_id: string
  question_text: string
  correct_answer: string
  user_answer?: string
  hints: string[]
  common_mistakes: { mistake: string; guidance: string }[]
  conversation: ChatMessage[]
  mode: 'concept_question' | 'wrong_answer_guide' | 'praise'
}
