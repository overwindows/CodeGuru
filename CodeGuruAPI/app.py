from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, send_from_directory
app = Flask(__name__)


@app.route('/')
def index():
   print('Request for index page received')
   return render_template('index.html')

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static'),
                               'favicon.ico', mimetype='image/vnd.microsoft.icon')

@app.route('/hello', methods=['POST'])
def hello():
   content = request.form.get('content')
   tasks = request.form.get('tasks')
   if content and content != '':
      if tasks == 'code_beautify':         
         response = beautify(content)
         return render_template('beautify.html', response = response)
      else:
         return redirect(url_for('index')
   else:
       print('Request for hello page received with no name or blank name -- redirecting')
       return redirect(url_for('index'))

if __name__ == '__main__':
   app.run()
   