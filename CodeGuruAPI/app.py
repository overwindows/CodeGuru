from codeguru import beautify_code, review_code, transpile_code, commit_msg
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
   task = request.form.get('tasks')
   # print(task)
   if content and content != '':
      # print('Request for hello page received with name: ' + content)
      if task == 'code_beautify':         
         response = beautify_code(content)
         return render_template('beautify.html', response = response)
      elif task == 'code_review':
         print('Request for code review page received')
         response = review_code(content)
         return render_template('review.html', response = response)
      elif task == 'code_trans':
         response = transpile_code(content)
         return render_template('transpile.html', response = response)
      elif task == 'commit_msg':
         response = commit_msg(content)
         return render_template('commit.html', response = response) 
      else:
         return redirect(url_for('index'))
   else:
       print('Request for hello page received with no name or blank name -- redirecting')
       return redirect(url_for('index'))

if __name__ == '__main__':
   app.run()
   