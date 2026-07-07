import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { LessonPage } from './pages/LessonPage'
import { HistoryPage } from './pages/HistoryPage'
import { SkillPage } from './pages/SkillPage'

export function App() {
  useEffect(() => {
    // 旧 localStorage キーの汚染掃除（マウント時に 1 回だけ実行）
    // R2 が source of truth なので answers 系は不要
    try {
      localStorage.removeItem('answers')
    } catch {
      // プライベートモード等は無視
    }
  }, [])

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/lesson/:id" element={<LessonPage />} />
          <Route path="/skill" element={<SkillPage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
