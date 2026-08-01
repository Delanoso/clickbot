import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { CollectionProvider } from './context/CollectionContext'
import { Layout } from './components/Layout'
import { OverviewPage } from './pages/Overview'
import { CollectionPage } from './pages/Collection'
import { DecisionsPage } from './pages/Decisions'
import { ImportPage } from './pages/Import'
import { AddPage } from './pages/Add'

export default function App() {
  return (
    <CollectionProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/collection" element={<CollectionPage />} />
            <Route path="/decisions" element={<DecisionsPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/add" element={<AddPage />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </CollectionProvider>
  )
}
