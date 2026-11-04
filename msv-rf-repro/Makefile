all: MSV-Computational-Model-Development.html MSV-Analysis-Replication-Notebook.html

MSV-Computational-Model-Development.html:
	jupyter nbconvert --to html --execute 'code/MSV Computational Model Development.ipynb'
	mv 'code/MSV Computational Model Development.html' MSV-Computational-Model-Development.html
MSV-Analysis-Replication-Notebook.html:
	Rscript -e "rmarkdown::render('code/MSV Analysis Replication Notebook.Rmd', output_file='MSV-Analysis-Replication-Notebook.html', output_dir='.')"
