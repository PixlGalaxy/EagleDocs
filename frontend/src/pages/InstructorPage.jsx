import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../utils/api';
import { useAuth } from '../context/AuthContext';

const InstructorPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [savingCourse, setSavingCourse] = useState(false);
  const [uploading, setUploading] = useState({});
  const [documents, setDocuments] = useState({});

  useEffect(() => {
    if (user && user.role !== 'instructor') {
      navigate('/chat');
    }
  }, [user, navigate]);

  const loadCourses = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('/courses');
      setCourses(data.courses || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCourses();
  }, []);

  const handleCreateCourse = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setSavingCourse(true);
    setError('');
    try {
      const data = await apiRequest('/courses', {
        method: 'POST',
        body: { code, title },
      });
      setCourses((prev) => {
        const existingIndex = prev.findIndex((c) => c.id === data.course.id);
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = data.course;
          return updated;
        }
        return [data.course, ...prev];
      });
      setCode('');
      setTitle('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCourse(false);
    }
  };

  const handleFileChange = async (courseId, file) => {
    if (!file) return;
    setUploading((prev) => ({ ...prev, [courseId]: true }));
    setError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      await apiRequest(`/courses/${courseId}/documents`, {
        method: 'POST',
        body: formData,
      });
      await loadCourses();
      await loadDocuments(courseId);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading((prev) => ({ ...prev, [courseId]: false }));
    }
  };

  const loadDocuments = async (courseId) => {
    try {
      const data = await apiRequest(`/courses/${courseId}/documents`);
      setDocuments((prev) => ({ ...prev, [courseId]: data.documents || [] }));
    } catch (err) {
      setError(err.message);
    }
  };

  const renderDocuments = (courseId) => {
    const list = documents[courseId] || [];
    if (!list.length) {
      return <p className="text-sm text-gray-500">No documents uploaded yet.</p>;
    }
    return (
      <ul className="text-sm text-gray-700 space-y-1 mt-2">
        {list.map((doc) => (
          <li key={doc.id} className="flex justify-between items-center">
            <span className="truncate" title={doc.original_name}>
              {doc.original_name}
            </span>
            <span className="text-gray-400 text-xs">{new Date(doc.uploaded_at).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-5xl mx-auto bg-white shadow-sm rounded-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Instructor Workspace</h1>
            <p className="text-gray-600 text-sm">Define course codes and upload PDFs to feed the RAG.</p>
          </div>
          <button
            onClick={() => navigate('/chat')}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            Go to chat
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>
        )}

        <form onSubmit={handleCreateCourse} className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Course code</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. COP1234"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Title (optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Course title"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={savingCourse}
              className={`w-full md:w-auto bg-blue-600 text-white px-4 py-2 rounded text-sm ${
                savingCourse ? 'opacity-60 cursor-not-allowed' : 'hover:bg-blue-700'
              }`}
            >
              {savingCourse ? 'Saving...' : 'Save course'}
            </button>
          </div>
        </form>

        {loading ? (
          <p className="text-gray-600">Loading courses...</p>
        ) : (
          <div className="space-y-4">
            {courses.map((course) => (
              <div key={course.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">
                      {course.code}
                      {course.title ? ` - ${course.title}` : ''}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {course.document_count} document{course.document_count === '1' ? '' : 's'} indexed
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-blue-600 cursor-pointer">
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={(e) => handleFileChange(course.id, e.target.files?.[0])}
                    />
                    <span className="bg-blue-50 border border-blue-200 px-3 py-1 rounded">
                      {uploading[course.id] ? 'Uploading...' : 'Upload PDF'}
                    </span>
                  </label>
                </div>
                <div className="mt-3">
                  <button
                    onClick={() => loadDocuments(course.id)}
                    className="text-xs text-gray-600 underline"
                  >
                    Refresh documents
                  </button>
                  {renderDocuments(course.id)}
                </div>
              </div>
            ))}
            {!courses.length && <p className="text-gray-600">No courses yet. Create one to start building RAG data.</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export default InstructorPage;
