import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout, MorePage } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Course } from './pages/Course'
import { Lesson } from './pages/Lesson'
import { Grammar, ConceptPage } from './pages/Grammar'
import { Vocab } from './pages/Vocab'
import { Review } from './pages/Review'
import { Errors } from './pages/Errors'
import { Practice } from './pages/Practice'
import { Challenges, Daily } from './pages/Challenges'
import { Stats } from './pages/Stats'
import { Tutor } from './pages/Tutor'
import { Search } from './pages/Search'
import { Settings } from './pages/Settings'

export function App() {
  return <BrowserRouter basename="/german"><Routes><Route element={<Layout />}>
    <Route path="/" element={<Dashboard />} />
    <Route path="/curso" element={<Course />} />
    <Route path="/curso/:id" element={<Lesson />} />
    <Route path="/gramatica" element={<Grammar />} />
    <Route path="/gramatica/:id" element={<ConceptPage />} />
    <Route path="/vocabulario" element={<Vocab />} />
    <Route path="/repasar" element={<Review />} />
    <Route path="/errores" element={<Errors />} />
    <Route path="/practica" element={<Practice />} />
    <Route path="/retos" element={<Challenges />} />
    <Route path="/retos/daily" element={<Daily />} />
    <Route path="/estadisticas" element={<Stats />} />
    <Route path="/tutor" element={<Tutor />} />
    <Route path="/conversacion" element={<Tutor conversation />} />
    <Route path="/buscar" element={<Search />} />
    <Route path="/ajustes" element={<Settings />} />
    <Route path="/mas" element={<MorePage />} />
    <Route path="*" element={<Dashboard />} />
  </Route></Routes></BrowserRouter>
}
