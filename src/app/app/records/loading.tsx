export default function RecordsLoading() {
  return (
    <main className="folder-library folder-library-loading" aria-label="Loading learning folders">
      <header className="folder-library-header"><div><i /><b /><span /></div></header>
      <div className="folder-library-layout">
        <aside className="subject-folders"><i />{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</aside>
        <section className="subject-records"><header><div><i /><b /></div></header>{Array.from({ length: 4 }, (_, index) => <article key={index} />)}</section>
      </div>
    </main>
  );
}
